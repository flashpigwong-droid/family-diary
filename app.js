const colors = ["#66b99a", "#e86f5c", "#557cbb", "#dba83d", "#c45d7c"];
const storageKey = "family-diary-prototype";
const appVersion = "20260517-1";
const feedbackEndpoint = window.FAMILY_DIARY_FEEDBACK_ENDPOINT || "/api/feedback";

const initialState = {
  activeMemberId: "mama",
  members: [
    { id: "mama", name: "妈妈", color: "#e86f5c" },
    { id: "baba", name: "爸爸", color: "#557cbb" },
    { id: "kid", name: "小雨", color: "#66b99a" }
  ],
  entries: [
    {
      id: "seed-1",
      memberId: "kid",
      text: "今天放学路上看见很大的云，像一艘船。晚上全家一起吃了番茄面。",
      transcript: "",
      shared: true,
      audioSeconds: 38,
      audioDataUrl: "",
      images: [],
      context: null,
      createdAt: new Date().toISOString()
    },
    {
      id: "seed-2",
      memberId: "mama",
      text: "小雨自己收拾了书包，还认真讲了学校里的科学课。感觉今天家里很轻松。",
      transcript: "",
      shared: false,
      audioSeconds: 0,
      audioDataUrl: "",
      images: [],
      context: null,
      createdAt: new Date().toISOString()
    }
  ],
  chat: [
    { role: "assistant", text: "你可以问我：今天谁写了日记、这周有哪些开心的事、哪些日记分享到了广场。" }
  ],
  feedbacks: [],
  drafts: {}
};

let state = loadState();
let mediaRecorder = null;
let currentChunks = [];
let recordingStartedAt = null;
let selectedColor = colors[0];
let currentAudioDataUrl = "";
let pendingAudioRead = false;
let isHoldingRecord = false;
let recognition = null;
let isTextRecording = false;
let speechStartInProgress = false;
let selectedImages = [];
let speechInsertStart = 0;
let speechRenderedText = "";
let speechPrefix = "";
let speechResultTexts = new Map();
let speechFinalResultIndexes = new Set();
let latestRecognitionResultLength = 0;
let speechMinimumResultIndex = 0;
let isApplyingSpeechText = false;
let draftSaveTimer = null;
let currentDailyContext = null;
let editingEntryId = null;
let remoteFeedbackLoaded = false;

const els = {
  memberList: document.querySelector("#memberList"),
  addMemberBtn: document.querySelector("#addMemberBtn"),
  tabs: document.querySelectorAll(".nav-tab"),
  views: document.querySelectorAll(".view"),
  viewTitle: document.querySelector("#viewTitle"),
  todayLabel: document.querySelector("#todayLabel"),
  activeMemberDot: document.querySelector("#activeMemberDot"),
  activeMemberName: document.querySelector("#activeMemberName"),
  recordStatus: document.querySelector("#recordStatus"),
  holdRecordBtn: document.querySelector("#holdRecordBtn"),
  toggleRecordBtn: document.querySelector("#toggleRecordBtn"),
  recordHint: document.querySelector("#recordHint"),
  meter: document.querySelector(".meter"),
  diaryText: document.querySelector("#diaryText"),
  draftStatus: document.querySelector("#draftStatus"),
  clearDraftBtn: document.querySelector("#clearDraftBtn"),
  dailyContext: document.querySelector("#dailyContext"),
  refreshContextBtn: document.querySelector("#refreshContextBtn"),
  pickImageBtn: document.querySelector("#pickImageBtn"),
  takePhotoBtn: document.querySelector("#takePhotoBtn"),
  imageInput: document.querySelector("#imageInput"),
  cameraInput: document.querySelector("#cameraInput"),
  imagePreview: document.querySelector("#imagePreview"),
  includeContext: document.querySelector("#includeContext"),
  shareToSquare: document.querySelector("#shareToSquare"),
  saveEntryBtn: document.querySelector("#saveEntryBtn"),
  mergedToday: document.querySelector("#mergedToday"),
  todayEntries: document.querySelector("#todayEntries"),
  entryCount: document.querySelector("#entryCount"),
  squareEntries: document.querySelector("#squareEntries"),
  calendarGrid: document.querySelector("#calendarGrid"),
  chatLog: document.querySelector("#chatLog"),
  chatForm: document.querySelector("#chatForm"),
  chatInput: document.querySelector("#chatInput"),
  quickReplies: document.querySelector("#quickReplies"),
  feedbackForm: document.querySelector("#feedbackForm"),
  feedbackType: document.querySelector("#feedbackType"),
  feedbackPriority: document.querySelector("#feedbackPriority"),
  feedbackText: document.querySelector("#feedbackText"),
  feedbackContact: document.querySelector("#feedbackContact"),
  feedbackSubmitStatus: document.querySelector("#feedbackSubmitStatus"),
  feedbackList: document.querySelector("#feedbackList"),
  feedbackCount: document.querySelector("#feedbackCount"),
  memberDialog: document.querySelector("#memberDialog"),
  newMemberName: document.querySelector("#newMemberName"),
  colorChoices: document.querySelector("#colorChoices"),
  confirmMemberBtn: document.querySelector("#confirmMemberBtn")
};

function loadState() {
  const saved = localStorage.getItem(storageKey);
  const loaded = saved ? JSON.parse(saved) : initialState;
  loaded.drafts ||= {};
  loaded.chat ||= initialState.chat;
  loaded.feedbacks ||= [];
  return loaded;
}

function saveState() {
  localStorage.setItem(storageKey, JSON.stringify(state));
}

function activeMember() {
  return state.members.find((member) => member.id === state.activeMemberId) || state.members[0];
}

function formatDate(date) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
    weekday: "long"
  }).format(date);
}

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function entriesForActiveMember() {
  return state.entries.filter((entry) => entry.memberId === state.activeMemberId);
}

function draftForActiveMember() {
  return state.drafts?.[state.activeMemberId] || {};
}

function draftHasContent(draft) {
  return Boolean(
    draft.text ||
    draft.shared ||
    draft.audioDataUrl ||
    Number(draft.audioSeconds || 0) ||
    draft.images?.length
  );
}

function loadActiveDraft() {
  const draft = draftForActiveMember();
  els.diaryText.value = draft.text || "";
  els.shareToSquare.checked = Boolean(draft.shared);
  els.includeContext.checked = draft.includeContext !== false;
  currentAudioDataUrl = draft.audioDataUrl || "";
  currentDailyContext = draft.context || null;
  editingEntryId = draft.editingEntryId || null;
  els.recordStatus.dataset.lastAudioSeconds = String(draft.audioSeconds || 0);
  selectedImages = [...(draft.images || [])];
  renderImagePreview();
  renderDailyContext();
  updateSaveButtonLabel();
  setDraftStatus(draftHasContent(draft) ? "已恢复上次未保存内容" : "草稿会自动保存");
}

function saveCurrentDraft(immediate = false) {
  clearTimeout(draftSaveTimer);
  const save = () => {
    const draft = {
      text: els.diaryText.value,
      shared: els.shareToSquare.checked,
      includeContext: els.includeContext.checked,
      audioDataUrl: currentAudioDataUrl,
      audioSeconds: Number(els.recordStatus.dataset.lastAudioSeconds || 0),
      images: selectedImages,
      context: currentDailyContext,
      editingEntryId,
      updatedAt: new Date().toISOString()
    };
    if (draftHasContent(draft)) {
      state.drafts[state.activeMemberId] = draft;
      setDraftStatus("草稿已自动保存");
    } else {
      delete state.drafts[state.activeMemberId];
      setDraftStatus("草稿会自动保存");
    }
    saveState();
  };
  if (immediate) {
    save();
    return;
  }
  setDraftStatus("正在保存草稿");
  draftSaveTimer = setTimeout(save, mediaRecorder && mediaRecorder.state === "recording" ? 2500 : 1200);
}

function clearActiveDraft() {
  delete state.drafts[state.activeMemberId];
  els.diaryText.value = "";
  els.shareToSquare.checked = false;
  els.includeContext.checked = true;
  currentAudioDataUrl = "";
  currentDailyContext = null;
  editingEntryId = null;
  els.recordStatus.dataset.lastAudioSeconds = "0";
  selectedImages = [];
  speechRenderedText = "";
  speechResultTexts.clear();
  speechFinalResultIndexes.clear();
  speechMinimumResultIndex = latestRecognitionResultLength;
  renderImagePreview();
  renderDailyContext();
  updateSaveButtonLabel();
  setDraftStatus("已清空，可以重新输入");
  saveState();
}

function updateSaveButtonLabel() {
  els.saveEntryBtn.textContent = editingEntryId ? "更新记录" : "保存今天";
}

function setDraftStatus(text) {
  els.draftStatus.textContent = text;
}

function renderDailyContext() {
  els.dailyContext.textContent = formatContext(currentDailyContext);
}

function formatContext(context) {
  if (!context) return "暂未获取。允许位置权限后，会自动补充位置和天气。";
  const parts = [];
  if (context.locationLabel) parts.push(context.locationLabel);
  if (context.weatherText) parts.push(context.weatherText);
  return parts.length ? parts.join(" · ") : "已尝试获取当天信息。";
}

async function refreshDailyContext() {
  if (!navigator.geolocation) {
    currentDailyContext = { locationLabel: "当前浏览器不支持位置获取", weatherText: "" };
    renderDailyContext();
    saveCurrentDraft();
    return;
  }

  els.dailyContext.textContent = "正在获取位置和天气。";
  try {
    const position = await new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: false,
        timeout: 9000,
        maximumAge: 1000 * 60 * 30
      });
    });
  const { latitude, longitude } = position.coords;
    currentDailyContext = {
      latitude,
      longitude,
      locationLabel: `当前位置 ${latitude.toFixed(2)}, ${longitude.toFixed(2)}`,
      weatherText: "天气获取中",
      capturedAt: new Date().toISOString()
    };
    renderDailyContext();
    await loadPlaceForPosition(latitude, longitude);
    await loadWeatherForPosition(latitude, longitude);
  } catch (error) {
    currentDailyContext = {
      locationLabel: error?.code === 1 ? "未允许位置权限" : "位置获取失败",
      weatherText: ""
    };
    renderDailyContext();
  }
  saveCurrentDraft();
}

async function loadPlaceForPosition(latitude, longitude) {
  try {
    const params = new URLSearchParams({
      format: "jsonv2",
      lat: String(latitude),
      lon: String(longitude),
      zoom: "12",
      "accept-language": "zh-CN"
    });
    const response = await fetch(`https://nominatim.openstreetmap.org/reverse?${params}`);
    if (!response.ok) throw new Error("place");
    const data = await response.json();
    const address = data.address || {};
    const city = address.city || address.town || address.municipality || address.state || "";
    const district = address.city_district || address.district || address.suburb || address.county || "";
    currentDailyContext = {
      ...currentDailyContext,
      city,
      district,
      locationLabel: [city, district].filter(Boolean).join(" · ") || currentDailyContext.locationLabel
    };
  } catch {
    currentDailyContext = {
      ...currentDailyContext,
      locationLabel: currentDailyContext.locationLabel || "位置暂时不可用"
    };
  }
  renderDailyContext();
}

async function loadWeatherForPosition(latitude, longitude) {
  try {
    const params = new URLSearchParams({
      latitude: String(latitude),
      longitude: String(longitude),
      current: "temperature_2m,weather_code",
      timezone: "auto"
    });
    const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
    if (!response.ok) throw new Error("weather");
    const data = await response.json();
    const current = data.current || {};
    const temperature = Math.round(Number(current.temperature_2m));
    currentDailyContext = {
      ...currentDailyContext,
      weatherCode: current.weather_code,
      temperature,
      weatherText: `${weatherCodeText(current.weather_code)} ${Number.isFinite(temperature) ? `${temperature}°C` : ""}`.trim()
    };
  } catch {
    currentDailyContext = {
      ...currentDailyContext,
      weatherText: "天气暂时不可用"
    };
  }
  renderDailyContext();
}

function weatherCodeText(code) {
  const value = Number(code);
  if ([0].includes(value)) return "晴";
  if ([1, 2, 3].includes(value)) return "多云";
  if ([45, 48].includes(value)) return "有雾";
  if ([51, 53, 55, 56, 57].includes(value)) return "毛毛雨";
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(value)) return "下雨";
  if ([71, 73, 75, 77, 85, 86].includes(value)) return "下雪";
  if ([95, 96, 99].includes(value)) return "雷雨";
  return "天气";
}

function ensureDailyContext() {
  if (currentDailyContext) return;
  refreshDailyContext();
}

function render() {
  const member = activeMember();
  els.todayLabel.textContent = formatDate(new Date());
  els.activeMemberName.textContent = member.name;
  els.activeMemberDot.style.background = member.color;
  renderMembers();
  renderEntries();
  renderSquare();
  renderCalendar();
  renderChat();
  renderFeedback();
  saveState();
}

function renderMembers() {
  els.memberList.innerHTML = "";
  state.members.forEach((member) => {
    const button = document.createElement("button");
    button.className = `member-card ${member.id === state.activeMemberId ? "active" : ""}`;
    button.type = "button";
    button.innerHTML = `<span class="avatar" style="background:${member.color}">${member.name.slice(0, 1)}</span><span>${member.name}</span>`;
    button.addEventListener("click", () => {
      saveCurrentDraft(true);
      state.activeMemberId = member.id;
      loadActiveDraft();
      ensureDailyContext();
      render();
    });
    els.memberList.appendChild(button);
  });
}

function renderEntries() {
  const today = new Date();
  const entries = entriesForActiveMember().filter((entry) => sameDay(new Date(entry.createdAt), today));
  els.entryCount.textContent = `${entries.length} 条`;
  renderMergedToday(entries);
  els.todayEntries.innerHTML = entries.length ? "" : `<div class="empty-state">今天还没有记录。先按住说一段，或者写下几句话。</div>`;
  entries.forEach((entry) => els.todayEntries.appendChild(entryCard(entry)));
}

function renderMergedToday(entries) {
  if (!entries.length) {
    els.mergedToday.innerHTML = `<h4>当天合并记录</h4><p>今天的文字、语音转写和图片会自动汇总在这里。</p>`;
    return;
  }
  const mergedText = entries
    .slice()
    .reverse()
    .map((entry) => [entry.transcript, entry.text].filter(Boolean).join(" "))
    .filter(Boolean)
    .join(" ");
  const audioCount = entries.filter((entry) => entry.audioDataUrl).length;
  const imageCount = entries.reduce((count, entry) => count + (entry.images?.length || 0), 0);
  els.mergedToday.innerHTML = `
    <h4>当天合并记录</h4>
    <p>${escapeHtml(mergedText || "今天主要留下了语音、图片或空白片段。")}</p>
    <div class="audio-pill">● ${entries.length} 段素材 · ${audioCount} 段语音 · ${imageCount} 张图片</div>
  `;
}

function renderSquare() {
  const sharedEntries = state.entries.filter((entry) => entry.shared);
  els.squareEntries.innerHTML = sharedEntries.length ? "" : `<div class="empty-state">还没有家人分享日记。</div>`;
  sharedEntries.forEach((entry) => {
    const card = entryCard(entry);
    card.classList.add("square-card");
    els.squareEntries.appendChild(card);
  });
}

function entryCard(entry) {
  const member = state.members.find((item) => item.id === entry.memberId);
  const entryText = [entry.transcript, entry.text].filter(Boolean).join(" ");
  const images = entry.images || [];
  const card = document.createElement("article");
  card.className = "entry-card";
  card.dataset.entryId = entry.id;
  card.innerHTML = `
    <div class="entry-meta">
      <span>${escapeHtml(member?.name || "家人")}</span>
      <span>${new Date(entry.createdAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</span>
    </div>
    <div>${escapeHtml(entryText || "只有语音或图片记录。")}</div>
    ${images.length ? `<div class="entry-images">${images.map((src) => `<div class="image-thumb"><img class="entry-image" src="${src}" alt="日记图片" /></div>`).join("")}</div>` : ""}
    ${entry.audioDataUrl ? `<audio class="audio-player" controls src="${entry.audioDataUrl}"></audio>` : ""}
    ${entry.audioSeconds ? `<div class="audio-pill">● ${entry.audioSeconds} 秒语音</div>` : ""}
    <div class="entry-card-actions">
      <button class="text-button" type="button" data-action="edit" data-entry-id="${entry.id}">编辑</button>
      <button class="text-button" type="button" data-action="share" data-entry-id="${entry.id}">${entry.shared ? "取消广场" : "放入广场"}</button>
    </div>
  `;
  return card;
}

function renderCalendar() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const days = new Date(year, month + 1, 0).getDate();
  const firstDay = new Date(year, month, 1).getDay();
  const entryDays = new Set(entriesForActiveMember().map((entry) => new Date(entry.createdAt).getDate()));
  els.calendarGrid.innerHTML = "";
  for (let i = 0; i < firstDay; i += 1) {
    els.calendarGrid.appendChild(document.createElement("span"));
  }
  for (let day = 1; day <= days; day += 1) {
    const cell = document.createElement("div");
    cell.className = `day-cell ${entryDays.has(day) ? "has-entry" : ""}`;
    cell.textContent = day;
    els.calendarGrid.appendChild(cell);
  }
}

function renderChat() {
  els.chatLog.innerHTML = "";
  state.chat.forEach((message) => {
    const bubble = document.createElement("div");
    bubble.className = `chat-bubble ${message.role}`;
    bubble.textContent = message.text;
    els.chatLog.appendChild(bubble);
  });
}

function renderFeedback() {
  const feedbacks = state.feedbacks || [];
  els.feedbackCount.textContent = `${feedbacks.length} 条`;
  els.feedbackList.innerHTML = feedbacks.length ? "" : `<div class="empty-state">还没有收到反馈。家人提交后会自动记录在这里。</div>`;
  feedbacks
    .slice()
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .forEach((feedback) => {
      const member = state.members.find((item) => item.id === feedback.memberId);
      const card = document.createElement("article");
      card.className = "feedback-card";
      card.innerHTML = `
        <div class="feedback-card-top">
          <span>${escapeHtml(feedback.type)} · ${escapeHtml(feedback.priority)}</span>
          <span>${new Date(feedback.createdAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
        </div>
        <p>${escapeHtml(feedback.text)}</p>
        <div class="feedback-card-meta">
          <span>${escapeHtml(member?.name || "家人")}</span>
          <span>${escapeHtml(feedback.syncStatus || "已记录")}</span>
        </div>
      `;
      els.feedbackList.appendChild(card);
    });
}

async function startRecording(mode) {
  const speechSupported = supportsSpeechRecognition();

  if (speechSupported) {
    const started = await startSpeechRecognition();
    if (started) {
      isTextRecording = true;
      recordingStartedAt = Date.now();
      currentAudioDataUrl = "";
      els.recordStatus.dataset.lastAudioSeconds = "0";
      setRecordStatus(mode === "hold" ? "正在按住转写" : "连续转写中", "当前浏览器优先把语音直接写进输入框；H5 测试版暂不同时保存原始音频。");
      setMeterActive(true);
      return true;
    }
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    setRecordStatus(speechSupported ? "正在语音转写" : "当前浏览器不支持录音", speechSupported ? "此浏览器只能转文字，不能保存原始音频。" : "请换用 Chrome、Edge 或 Safari 的较新版本。");
    if (speechSupported) {
      const started = await startSpeechRecognition();
      isTextRecording = started;
      setMeterActive(started);
      return started;
    }
    resetRecordingButtons();
    return false;
  }
  if (!window.MediaRecorder) {
    if (speechSupported) {
      const started = await startSpeechRecognition();
      isTextRecording = started;
      setRecordStatus("正在语音转写", "此浏览器不能保存原始音频，但可以把语音转成文字。");
      setMeterActive(started);
      return started;
    }
    setRecordStatus("当前浏览器不能保存录音", "请换用 Chrome、Edge 或 Safari 的较新版本。");
    resetRecordingButtons();
    return false;
  }

  try {
    const speechStarted = await startSpeechRecognition();
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    setRecordStatus(mode === "hold" ? "正在按住录音" : "连续录音中");
    if (!speechStarted && speechSupported) {
      els.recordHint.textContent = "浏览器暂时没有启动实时转写，仍会保存语音。";
    }
    currentChunks = [];
    currentAudioDataUrl = "";
    pendingAudioRead = false;
    const mimeType = preferredAudioMimeType();
    mediaRecorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    recordingStartedAt = Date.now();
    mediaRecorder.addEventListener("dataavailable", (event) => {
      if (event.data.size > 0) currentChunks.push(event.data);
    });
    mediaRecorder.addEventListener("stop", () => {
      stream.getTracks().forEach((track) => track.stop());
      const seconds = Math.max(1, Math.round((Date.now() - recordingStartedAt) / 1000));
      const audioBlob = new Blob(currentChunks, { type: mediaRecorder.mimeType || "audio/webm" });
      els.recordStatus.dataset.lastAudioSeconds = String(seconds);
      pendingAudioRead = true;
      setRecordStatus("正在保存语音");
      resetRecordingButtons();
      stopSpeechRecognition();

      if (!audioBlob.size) {
        pendingAudioRead = false;
        setRecordStatus("没有录到声音，请再试一次");
        return;
      }

      const reader = new FileReader();
      reader.addEventListener("loadend", () => {
        currentAudioDataUrl = String(reader.result || "");
        pendingAudioRead = false;
        setRecordStatus(`已记录 ${seconds} 秒语音`);
        saveCurrentDraft();
      });
      reader.addEventListener("error", () => {
        pendingAudioRead = false;
        setRecordStatus("语音保存失败，请再试一次");
      });
      reader.readAsDataURL(audioBlob);
    });
    mediaRecorder.addEventListener("error", () => {
      stream.getTracks().forEach((track) => track.stop());
      setRecordStatus("录音中断，请再试一次");
      resetRecordingButtons();
      stopSpeechRecognition();
    });
    mediaRecorder.start(250);
    setMeterActive(true);
    return true;
  } catch (error) {
    setRecordStatus(recordingErrorText(error), recordingErrorHint(error));
    resetRecordingButtons();
    stopSpeechRecognition();
    return false;
  }
}

function supportsSpeechRecognition() {
  return Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
}

function isMobileLikeBrowser() {
  return /Android|iPhone|iPad|iPod|Mobile|MicroMessenger/i.test(navigator.userAgent);
}

async function startSpeechRecognition() {
  if (speechStartInProgress) return false;
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  speechRenderedText = "";
  speechResultTexts.clear();
  speechFinalResultIndexes.clear();
  latestRecognitionResultLength = 0;
  speechMinimumResultIndex = 0;
  speechInsertStart = els.diaryText.selectionStart ?? els.diaryText.value.length;
  speechPrefix = speechInsertStart > 0 && !/\s$/.test(els.diaryText.value.slice(0, speechInsertStart)) ? "\n" : "";
  if (!Recognition) {
    els.recordHint.textContent = "当前浏览器不支持实时转写，但会保留语音录音和文字草稿。";
    return false;
  }

  speechStartInProgress = true;
  const permissionReady = await warmUpMicrophonePermission();
  if (!permissionReady) {
    speechStartInProgress = false;
    return false;
  }

  recognition = new Recognition();
  recognition.lang = "zh-CN";
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.addEventListener("result", (event) => {
    latestRecognitionResultLength = event.results.length;
    const startIndex = Math.max(event.resultIndex, speechMinimumResultIndex);
    for (let index = startIndex; index < event.results.length; index += 1) {
      const phrase = cleanSpeechPhrase(event.results[index][0].transcript, event.results[index].isFinal);
      if (!phrase) continue;
      speechResultTexts.set(index, phrase);
      if (event.results[index].isFinal) speechFinalResultIndexes.add(index);
    }
    if (speechResultTexts.size) renderSpeechIntoEditor();
  });
  recognition.addEventListener("error", (event) => {
    isTextRecording = false;
    speechStartInProgress = false;
    resetRecordingButtons();
    const reason = speechRecognitionErrorText(event?.error);
    setRecordStatus("转写不可用", reason);
  });
  recognition.addEventListener("end", () => {
    speechStartInProgress = false;
    if (isTextRecording) {
      commitSpeechSegment();
      try {
        recognition.start();
      } catch {
        isTextRecording = false;
      }
    }
  });

  try {
    recognition.start();
    speechStartInProgress = false;
    return true;
  } catch (error) {
    recognition = null;
    speechStartInProgress = false;
    setRecordStatus("转写启动失败", speechRecognitionErrorText(error?.name));
    return false;
  }
}

async function warmUpMicrophonePermission() {
  if (!navigator.mediaDevices?.getUserMedia) return true;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((track) => track.stop());
    return true;
  } catch (error) {
    setRecordStatus("需要麦克风权限", recordingErrorHint(error) || "请在浏览器地址栏、站点设置或系统设置里允许麦克风。");
    resetRecordingButtons();
    return false;
  }
}

function speechRecognitionErrorText(error) {
  if (error === "not-allowed") return "浏览器没有允许网页语音识别使用麦克风。请到站点设置里允许麦克风后刷新页面。";
  if (error === "service-not-allowed") return "当前浏览器或地区不可用网页语音识别服务。H5 需要接入服务端语音识别才能稳定转写。";
  if (error === "audio-capture") return "没有捕获到麦克风，请确认系统麦克风权限已打开。";
  if (error === "network") return "语音识别服务连接失败，请换网络或关闭 VPN 后再试。";
  if (error === "no-speech") return "没有识别到说话内容，请靠近麦克风再试。";
  if (error === "aborted") return "语音识别被浏览器中断，请重新点击连续转写。";
  return "语音识别没有启动成功。请确认 Chrome 已允许此页面使用麦克风。";
}

function stopSpeechRecognition() {
  isTextRecording = false;
  if (!recognition) return;
  try {
    recognition.stop();
  } catch {
    recognition = null;
  }
  renderSpeechIntoEditor();
  saveCurrentDraft();
}

function commitSpeechSegment() {
  if (!speechRenderedText) return;
  speechInsertStart += speechRenderedText.length;
  speechRenderedText = "";
  speechResultTexts.clear();
  speechFinalResultIndexes.clear();
  latestRecognitionResultLength = 0;
  speechMinimumResultIndex = 0;
  const value = els.diaryText.value;
  speechPrefix = speechInsertStart > 0 && !/\s$/.test(value.slice(0, speechInsertStart)) ? "\n" : "";
}

function renderSpeechIntoEditor() {
  const speechText = Array.from(speechResultTexts.entries())
    .sort((a, b) => a[0] - b[0])
    .map((entry) => entry[1])
    .join("");
  const text = speechText ? `${speechPrefix}${speechText}` : "";
  const current = els.diaryText.value;
  const before = current.slice(0, speechInsertStart);
  const after = current.slice(speechInsertStart + speechRenderedText.length);
  isApplyingSpeechText = true;
  els.diaryText.value = `${before}${text}${after}`;
  const cursor = speechInsertStart + text.length;
  els.diaryText.setSelectionRange(cursor, cursor);
  isApplyingSpeechText = false;
  speechRenderedText = text;
  saveCurrentDraft();
}

function cleanSpeechPhrase(value, isFinal = true) {
  const phrase = String(value || "").replace(/\s+/g, "").trim();
  if (!phrase || /^[。！？!?，,、；;：:\s]+$/.test(phrase)) return "";
  if (!isFinal) return phrase;
  return /[。！？!?]$/.test(phrase) ? phrase : `${phrase}。`;
}

function preferredAudioMimeType() {
  const types = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  return types.find((type) => MediaRecorder.isTypeSupported(type)) || "";
}

function recordingErrorText(error) {
  if (error?.name === "NotAllowedError") return "需要允许麦克风权限";
  if (error?.name === "NotFoundError") return "没有找到可用麦克风";
  if (error?.name === "NotReadableError") return "麦克风正被其他应用占用";
  if (location.protocol !== "https:" && location.hostname !== "127.0.0.1" && location.hostname !== "localhost") {
    return "录音需要安全网页环境";
  }
  return "录音启动失败，请再试一次";
}

function recordingErrorHint(error) {
  if (error?.name === "NotAllowedError") return "请在浏览器地址栏或系统设置里允许此页面使用麦克风，然后刷新页面再试。";
  if (error?.name === "NotReadableError") return "先关闭正在使用麦克风的会议、录音或浏览器标签页。";
  return "";
}

function setRecordStatus(text, hint = "") {
  els.recordStatus.textContent = text;
  els.recordHint.textContent = hint;
}

function resetRecordingButtons() {
  setMeterActive(false);
  els.holdRecordBtn.classList.remove("active");
  els.toggleRecordBtn.classList.remove("active");
}

function setMeterActive(active) {
  els.meter?.classList.toggle("active", active);
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    mediaRecorder.stop();
  }
  if (isTextRecording) {
    stopSpeechRecognition();
    resetRecordingButtons();
    const seconds = recordingStartedAt ? Math.max(1, Math.round((Date.now() - recordingStartedAt) / 1000)) : 0;
    setRecordStatus(seconds ? `已转写 ${seconds} 秒` : "已停止转写");
  }
}

els.holdRecordBtn.addEventListener("pointerdown", async () => {
  if ((mediaRecorder && mediaRecorder.state === "recording") || isTextRecording) return;
  isHoldingRecord = true;
  const started = await startRecording("hold");
  if (started) els.holdRecordBtn.classList.add("active");
  if (started && !isHoldingRecord) stopRecording();
});

["pointerup", "pointerleave", "pointercancel"].forEach((eventName) => {
  els.holdRecordBtn.addEventListener(eventName, () => {
    isHoldingRecord = false;
    stopRecording();
  });
});

els.toggleRecordBtn.addEventListener("click", async () => {
  if ((mediaRecorder && mediaRecorder.state === "recording") || isTextRecording) {
    stopRecording();
    return;
  }
  const started = await startRecording("live");
  if (started) els.toggleRecordBtn.classList.add("active");
});

els.pickImageBtn.addEventListener("click", () => els.imageInput.click());
els.takePhotoBtn.addEventListener("click", () => els.cameraInput.click());
els.imageInput.addEventListener("change", async () => {
  await addImagesFromFiles(els.imageInput.files);
  els.imageInput.value = "";
  saveCurrentDraft();
});
els.cameraInput.addEventListener("change", async () => {
  await addImagesFromFiles(els.cameraInput.files);
  els.cameraInput.value = "";
  saveCurrentDraft();
});

async function addImagesFromFiles(files) {
  const imageFiles = Array.from(files || []).filter((file) => file.type.startsWith("image/"));
  const dataUrls = await Promise.all(imageFiles.map(readFileAsDataUrl));
  selectedImages.push(...dataUrls);
  renderImagePreview();
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("loadend", () => resolve(String(reader.result || "")));
    reader.addEventListener("error", reject);
    reader.readAsDataURL(file);
  });
}

function renderImagePreview() {
  els.imagePreview.innerHTML = selectedImages.map((src, index) => `
    <div class="image-thumb">
      <img src="${src}" alt="待保存图片" />
      <button class="remove-image" type="button" data-image-index="${index}" aria-label="移除图片">×</button>
    </div>
  `).join("");
}

els.imagePreview.addEventListener("click", (event) => {
  const button = event.target.closest("[data-image-index]");
  if (!button) return;
  selectedImages.splice(Number(button.dataset.imageIndex), 1);
  renderImagePreview();
  saveCurrentDraft();
});

function handleEntryAction(event) {
  const button = event.target.closest("[data-action][data-entry-id]");
  if (!button) return;
  const entry = state.entries.find((item) => item.id === button.dataset.entryId);
  if (!entry) return;
  if (button.dataset.action === "edit") {
    editEntry(entry);
  }
  if (button.dataset.action === "share") {
    entry.shared = !entry.shared;
    saveState();
    render();
  }
}

els.todayEntries.addEventListener("click", handleEntryAction);
els.squareEntries.addEventListener("click", handleEntryAction);

function editEntry(entry) {
  saveCurrentDraft(true);
  editingEntryId = entry.id;
  state.activeMemberId = entry.memberId;
  els.diaryText.value = entryContent(entry);
  els.shareToSquare.checked = Boolean(entry.shared);
  els.includeContext.checked = entry.includeContext !== false && Boolean(entry.context);
  currentAudioDataUrl = entry.audioDataUrl || "";
  els.recordStatus.dataset.lastAudioSeconds = String(entry.audioSeconds || 0);
  selectedImages = [...(entry.images || [])];
  currentDailyContext = entry.context || null;
  renderImagePreview();
  renderDailyContext();
  updateSaveButtonLabel();
  setRecordStatus(entry.audioSeconds ? `已载入 ${entry.audioSeconds} 秒语音` : "正在编辑记录");
  setDraftStatus("正在编辑已保存日记");
  state.drafts[state.activeMemberId] = {
    text: els.diaryText.value,
    shared: els.shareToSquare.checked,
    includeContext: els.includeContext.checked,
    audioDataUrl: currentAudioDataUrl,
    audioSeconds: Number(els.recordStatus.dataset.lastAudioSeconds || 0),
    images: selectedImages,
    context: currentDailyContext,
    editingEntryId,
    updatedAt: new Date().toISOString()
  };
  saveState();
  render();
  document.querySelector("#journalView").classList.add("active-view");
  document.querySelector("#squareView").classList.remove("active-view");
  document.querySelector("#calendarView").classList.remove("active-view");
  document.querySelector("#feedbackView").classList.remove("active-view");
  els.tabs.forEach((item) => item.classList.toggle("active", item.dataset.view === "journal"));
  els.viewTitle.textContent = "今天的日记";
}

els.diaryText.addEventListener("input", () => {
  if (!isApplyingSpeechText) {
    if (mediaRecorder && mediaRecorder.state === "recording") {
      speechInsertStart = els.diaryText.selectionStart ?? els.diaryText.value.length;
      speechRenderedText = "";
      speechResultTexts.clear();
      speechFinalResultIndexes.clear();
      speechMinimumResultIndex = latestRecognitionResultLength;
      speechPrefix = speechInsertStart > 0 && !/\s$/.test(els.diaryText.value.slice(0, speechInsertStart)) ? "\n" : "";
    }
    saveCurrentDraft();
  }
});
els.shareToSquare.addEventListener("change", () => saveCurrentDraft());
els.includeContext.addEventListener("change", () => saveCurrentDraft());
els.clearDraftBtn.addEventListener("click", clearActiveDraft);
els.refreshContextBtn.addEventListener("click", refreshDailyContext);

els.saveEntryBtn.addEventListener("click", () => {
  const text = els.diaryText.value.trim();
  const audioSeconds = Number(els.recordStatus.dataset.lastAudioSeconds || 0);
  if (pendingAudioRead) {
    setRecordStatus("语音还在保存，请稍等");
    return;
  }
  if (!text && !audioSeconds && !selectedImages.length) {
    setRecordStatus("先写一点、录一段或加张图片");
    return;
  }
  const wasEditing = Boolean(editingEntryId);
  if (editingEntryId) {
    const entry = state.entries.find((item) => item.id === editingEntryId);
    if (entry) {
      entry.text = text;
      entry.transcript = "";
      entry.shared = els.shareToSquare.checked;
      entry.includeContext = els.includeContext.checked;
      entry.audioSeconds = audioSeconds;
      entry.audioDataUrl = currentAudioDataUrl;
      entry.images = selectedImages;
      entry.context = els.includeContext.checked ? currentDailyContext : null;
      entry.updatedAt = new Date().toISOString();
    }
  } else {
    state.entries.unshift({
      id: crypto.randomUUID(),
      memberId: state.activeMemberId,
      text,
      transcript: "",
      shared: els.shareToSquare.checked,
      includeContext: els.includeContext.checked,
      audioSeconds,
      audioDataUrl: currentAudioDataUrl,
      images: selectedImages,
      context: els.includeContext.checked ? currentDailyContext : null,
      createdAt: new Date().toISOString()
    });
  }
  els.diaryText.value = "";
  els.shareToSquare.checked = false;
  els.includeContext.checked = true;
  els.recordStatus.dataset.lastAudioSeconds = "0";
  currentAudioDataUrl = "";
  editingEntryId = null;
  speechRenderedText = "";
  speechResultTexts.clear();
  speechFinalResultIndexes.clear();
  selectedImages = [];
  renderImagePreview();
  updateSaveButtonLabel();
  delete state.drafts[state.activeMemberId];
  setRecordStatus(wasEditing ? "已更新" : "已保存");
  setDraftStatus("已保存，草稿已清空");
  render();
});

els.tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    saveCurrentDraft(true);
    els.tabs.forEach((item) => item.classList.remove("active"));
    els.views.forEach((view) => view.classList.remove("active-view"));
    tab.classList.add("active");
    document.querySelector(`#${tab.dataset.view}View`).classList.add("active-view");
    els.viewTitle.textContent = tab.textContent === "日记" ? "今天的日记" : tab.textContent;
  });
});

els.chatForm.addEventListener("submit", (event) => {
  event.preventDefault();
  askDiaryQuestion(els.chatInput.value);
});

els.quickReplies.addEventListener("click", (event) => {
  const button = event.target.closest("[data-question]");
  if (!button) return;
  askDiaryQuestion(button.dataset.question);
});

els.feedbackForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = els.feedbackText.value.trim();
  if (!text) {
    els.feedbackSubmitStatus.textContent = "请先写下反馈内容。";
    els.feedbackText.focus();
    return;
  }
  const member = activeMember();
  const feedback = {
    id: crypto.randomUUID(),
    memberId: state.activeMemberId,
    memberName: member.name,
    type: els.feedbackType.value,
    priority: els.feedbackPriority.value,
    text,
    contact: els.feedbackContact.value.trim(),
    page: activeViewName(),
    device: navigator.userAgent,
    appVersion,
    createdAt: new Date().toISOString(),
    syncStatus: "本机已记录"
  };
  state.feedbacks.unshift(feedback);
  saveState();
  renderFeedback();
  els.feedbackText.value = "";
  els.feedbackContact.value = "";
  els.feedbackSubmitStatus.textContent = "已提交，反馈后台已记录。";
  await syncFeedback(feedback);
});

function activeViewName() {
  const activeTab = Array.from(els.tabs).find((tab) => tab.classList.contains("active"));
  return activeTab?.textContent?.trim() || "日记";
}

async function syncFeedback(feedback) {
  const endpoint = resolveFeedbackEndpoint();
  if (!endpoint) return;
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(feedback)
    });
    if (!response.ok) throw new Error("feedback");
    feedback.syncStatus = "已同步后台";
  } catch {
    feedback.syncStatus = "本机已记录，等待后台同步";
  }
  saveState();
  renderFeedback();
}

function resolveFeedbackEndpoint() {
  if (!feedbackEndpoint || location.protocol === "file:") return "";
  return feedbackEndpoint;
}

async function loadRemoteFeedbacks() {
  const endpoint = resolveFeedbackEndpoint();
  if (!endpoint || remoteFeedbackLoaded) return;
  remoteFeedbackLoaded = true;
  try {
    const response = await fetch(endpoint);
    if (!response.ok) return;
    const data = await response.json();
    const remoteFeedbacks = Array.isArray(data.feedbacks) ? data.feedbacks : [];
    const knownIds = new Set((state.feedbacks || []).map((item) => item.id));
    remoteFeedbacks.forEach((feedback) => {
      if (!knownIds.has(feedback.id)) state.feedbacks.push(feedback);
    });
    saveState();
    renderFeedback();
  } catch {
    // 本地 H5 测试时没有后台接口，保持本机记录即可。
  }
}

function askDiaryQuestion(questionText) {
  const question = questionText.trim();
  if (!question) return;
  state.chat.push({ role: "user", text: question });
  state.chat.push({ role: "assistant", text: answerDiaryQuestion(question) });
  els.chatInput.value = "";
  render();
}

function entryContent(entry) {
  return [entry.transcript, entry.text].filter(Boolean).join(" ").trim();
}

function answerDiaryQuestion(question) {
  const entries = entriesForActiveMember();
  const shared = entries.filter((entry) => entry.shared).length;
  const today = entries.filter((entry) => sameDay(new Date(entry.createdAt), new Date()));
  const imageCount = entries.reduce((count, entry) => count + (entry.images?.length || 0), 0);
  const audioEntries = entries.filter((entry) => entry.audioDataUrl || entry.audioSeconds);
  const totalAudioSeconds = audioEntries.reduce((count, entry) => count + Number(entry.audioSeconds || 0), 0);
  const latest = entries.slice(0, 5);

  if (!entries.length) {
    return "你还没有保存日记。先在日记页写一段、录一段或加张图片，我就能围绕全部记录回答。";
  }
  if (question.includes("全部") || question.includes("所有") || question.includes("总结")) {
    const samples = latest.map((entry) => entryContent(entry) || "语音或图片记录").join("；");
    return `你一共保存了 ${entries.length} 条日记，包含 ${audioEntries.length} 段语音、${imageCount} 张图片、${shared} 条广场分享。最近几条是：${samples}`;
  }
  if (question.includes("分享") || question.includes("广场")) {
    return `你一共有 ${shared} 条日记分享到了广场，只有家人主动勾选的记录才会公开。`;
  }
  if (question.includes("图片") || question.includes("照片") || question.includes("拍照") || question.includes("语音") || question.includes("录音")) {
    return `你的全部日记里有 ${audioEntries.length} 条带语音，语音总时长约 ${totalAudioSeconds} 秒；还有 ${imageCount} 张图片。`;
  }
  if (question.includes("天气") || question.includes("位置") || question.includes("在哪") || question.includes("地点")) {
    const contexts = entries
      .map((entry) => formatContext(entry.context))
      .filter((text) => !text.startsWith("暂未获取"))
      .slice(0, 5);
    return contexts.length ? `这些日记带有当天信息：${contexts.join("；")}` : "目前保存的日记里还没有位置或天气信息。允许位置权限后，新日记会自动带上当天信息。";
  }
  if (question.includes("今天")) {
    return today.length ? `你今天写了 ${today.length} 条日记：${today.map((entry) => entryContent(entry) || "语音或图片记录").join("；")}` : "你今天还没有保存日记。";
  }
  if (question.includes("开心") || question.includes("快乐") || question.includes("轻松") || question.includes("高兴")) {
    const happyEntries = entries
      .filter((entry) => /开心|快乐|轻松|高兴|喜欢|好玩|一起|笑/.test(entryContent(entry)))
      .slice(0, 5);
    return happyEntries.length
      ? `这些记录里有一些开心线索：${happyEntries.map((entry) => entryContent(entry) || "语音或图片记录").join("；")}`
      : "我暂时没有在文字里找到明显的开心线索，但语音和图片记录也可能藏着好心情。";
  }
  if (question.includes("这周") || question.includes("最近")) {
    const recentText = latest.map((entry) => entryContent(entry) || "语音或图片记录").join("；");
    return `最近的记录是：${recentText}`;
  }
  const keywords = question
    .replace(/[，。？！?]/g, " ")
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length >= 2 && !["什么", "哪些", "日记", "记录", "我的"].includes(word));
  const matches = entries.filter((entry) => keywords.some((word) => entryContent(entry).includes(word))).slice(0, 5);
  if (matches.length) {
    return `我在你的全部日记里找到了 ${matches.length} 条相关记录：${matches.map((entry) => entryContent(entry) || "语音或图片记录").join("；")}`;
  }
  return `你的全部日记里目前有 ${entries.length} 条记录。你可以问“总结我的全部日记”“最近有哪些开心的事”“哪些记录有语音或图片”。`;
}

els.addMemberBtn.addEventListener("click", () => {
  selectedColor = colors[0];
  els.newMemberName.value = "";
  renderColorChoices();
  els.memberDialog.showModal();
});

function renderColorChoices() {
  els.colorChoices.innerHTML = "";
  colors.forEach((color) => {
    const button = document.createElement("button");
    button.className = `color-choice ${color === selectedColor ? "active" : ""}`;
    button.type = "button";
    button.style.background = color;
    button.addEventListener("click", () => {
      selectedColor = color;
      renderColorChoices();
    });
    els.colorChoices.appendChild(button);
  });
}

els.confirmMemberBtn.addEventListener("click", (event) => {
  const name = els.newMemberName.value.trim();
  if (!name) {
    event.preventDefault();
    els.newMemberName.focus();
    return;
  }
  const id = `${Date.now()}`;
  saveCurrentDraft(true);
  state.members.push({ id, name, color: selectedColor });
  state.activeMemberId = id;
  loadActiveDraft();
  ensureDailyContext();
  render();
});

render();
loadActiveDraft();
ensureDailyContext();
loadRemoteFeedbacks();
