# 家庭日记 H5

家庭成员共用的手机端日记原型，支持文字记录、语音录音入口、图片/拍照、日记广场、日历问答和产品反馈入口。

## 部署

推荐使用 Vercel 部署。项目包含 `/api/feedback` 接口，绑定 Vercel Blob 后可以集中保存测试反馈。

## 本地文件

- `index.html`：应用页面
- `styles.css`：手机 App 风格样式
- `app.js`：前端交互和本地数据
- `api/feedback.js`：Vercel 反馈接口
- `vercel.json`：Vercel 配置
