import { list, put } from "@vercel/blob";

const feedbackPrefix = "feedback/";

function setCors(response) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function feedbackPath(feedback) {
  const created = String(feedback.createdAt || new Date().toISOString()).replace(/[:.]/g, "-");
  return `${feedbackPrefix}${created}-${feedback.id}.json`;
}

export default async function handler(request, response) {
  setCors(response);
  if (request.method === "OPTIONS") {
    response.status(204).end();
    return;
  }

  try {
    if (request.method === "GET") {
      const result = await list({ prefix: feedbackPrefix, limit: 100 });
      const feedbacks = await Promise.all(
        result.blobs.map(async (blob) => {
          const blobResponse = await fetch(blob.url);
          return blobResponse.json();
        })
      );
      response.status(200).json({ feedbacks });
      return;
    }

    if (request.method === "POST") {
      const feedback = {
        ...request.body,
        serverReceivedAt: new Date().toISOString()
      };
      if (!feedback.id || !feedback.text) {
        response.status(400).json({ error: "反馈内容不完整" });
        return;
      }
      await put(feedbackPath(feedback), JSON.stringify(feedback, null, 2), {
        access: "public",
        addRandomSuffix: false,
        contentType: "application/json"
      });
      response.status(200).json({ ok: true, feedback });
      return;
    }

    response.setHeader("Allow", "GET,POST,OPTIONS");
    response.status(405).json({ error: "不支持的请求方式" });
  } catch (error) {
    response.status(500).json({
      error: "反馈后台暂时不可用",
      detail: error?.message || "unknown"
    });
  }
}
