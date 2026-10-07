# UNIVERSAL AI + FEEDBACK MODULE — INTEGRATION GUIDE
Version 1.2 — designed for Pi SoloHost apps (proven on Snake Arcade)

## 1. Mục tiêu kiến trúc

Mỗi app chỉ có **một** AI system và **một** Feedback system.

- Nếu app đã có AI: giữ UI + dữ liệu cần thiết, thay provider/router cũ bằng Universal AI Module hoặc adapter của module.
- Nếu app đã có Feedback: giữ dữ liệu lịch sử nếu có, thay phần Hub transport bằng Universal Feedback Module.
- Không tạo `/api/ai2`, `feedback2`, panel2, provider2.
- Một nút AI duy nhất mở một cửa sổ duy nhất: Chat → Feedback → Settings → Logs.
- Giao diện chính của app không được thiết kế lại.

Luồng:
`App UI → AI button → AI Panel → AI Module`
`                         ↘ Feedback Module → Feedback Hub`
`AI Module → App Adapter → đọc trạng thái / giải thích / thao tác app`

## 2. Hai module độc lập

### AI Module
Có:
- OpenAI
- Google Gemini
- DeepSeek
- Anthropic
- OpenRouter
- Groq
- Mistral
- xAI
- Custom OpenAI-compatible
- Local OpenAI-compatible (Ollama/LM Studio/vLLM… qua Base URL)
- Model `auto` hoặc model cụ thể
- Modes: cloud_enabled / balanced / prefer_local / local_only / custom
- server-side key storage, masked key
- logs
- conversation history
- app knowledge
- live app context
- safe app actions
- explain result
- interactive user manual

### Feedback Module
- Hub ID và endpoint cấu hình sẵn
- token chỉ ở server
- feedback bug/improvement/question
- rating
- offline/failed-send có thể được queue ở client
- notices từ Hub
- unread badge
- mark-read
- donate/support information lấy trực tiếp từ Hub
- không hard-code donate/payment details
- app identity tự truyền từ host

## 3. SECURITY — BẮT BUỘC

KHÔNG BAO GIỜ:
- trả ingest token qua `/api/feedback/config`
- đặt ingest token trong JS/browser
- ghi API key vào log
- gửi API key vào AI prompt
- để AI đọc `process.env`, `.env`, filesystem secrets
- cho AI tự thực thi shell/command/Docker
- cho AI tự gọi URL tùy ý
- cho AI thay đổi provider/key nếu host không cho phép

Token Feedback được giữ server-side trong `feedback-service.js`/environment.
API keys AI được giữ server-side trong `data/ai-settings.json` mode `0600`.

Nếu source ZIP được public, **hãy rotate ingest token** vì token nằm trong source server-side. Obfuscation không phải bảo mật.

## 4. APP ADAPTER — phần AI code bắt buộc đấu nối

Host app tạo adapter:

```js
const adapter = {
  // Trạng thái hiện tại của app. Không chứa secrets.
  async getContext(requestContext) {
    return {
      screen: '...',
      currentValue: '...',
      selectedItem: '...',
      recentHistory: [...]
    };
  },

  // Kiến thức chính xác của app. Có thể đọc từ static string hoặc app manifest.
  knowledge: `
    Tên app:
    Chức năng:
    Các nút:
    Các màn hình:
    Các quy tắc:
    Các lỗi người dùng thường gặp:
  `,

  // Chỉ các action được whitelist.
  actions: [
    { name:'open_settings', description:'Open app settings' },
    { name:'set_value', description:'Set the current value', requiresConfirmation:false },
    { name:'delete_item', description:'Delete selected item', requiresConfirmation:true }
  ],

  async executeAction(action) {
    // Validate AGAIN at server/host layer.
    // Never trust an action directly from the model.
    switch(action.name) {
      case 'open_settings': return {ok:true, action:'open_settings'};
      case 'set_value':
        // validate type/range before mutation
        return {ok:true, action:'set_value'};
      default:
        return {ok:false,error:'Action not allowed'};
    }
  }
};
```

### Quy tắc action
1. Model chỉ đề xuất action.
2. Host app validate action.
3. Action nguy hiểm cần confirmation ở UI.
4. Action thành công chỉ được báo thành công khi `executeAction()` trả `ok:true`.
5. Không cho model tự tạo action name ngoài whitelist.
6. Không truyền raw DOM, cookie, token, password vào context.

## 5. AI phải hiểu app như thế nào?

AI không được chỉ nhận một system prompt chung. Host phải cung cấp:

### Static knowledge
- app làm gì
- từng nút
- từng màn hình
- workflow
- giới hạn
- lỗi thường gặp
- ý nghĩa dữ liệu

### Live context
Ví dụ:
```json
{
  "screen":"checkout",
  "selectedProduct":"A",
  "total":125000,
  "recentActions":["add_product","apply_discount"]
}
```

### User history
Chỉ gửi phần cần thiết, ví dụ 8–20 message gần nhất.

Nhờ vậy người dùng có thể hỏi:
- “Kết quả vừa rồi là gì?”
- “Giải thích vì sao ra kết quả này.”
- “Tôi đang ở đâu?”
- “Nút này dùng làm gì?”
- “Làm bước tiếp theo.”
- “Tự động điền phần này.”
- “Có lỗi gì không?”

## 6. Explain Result

App nên phát sự kiện chuẩn:

```js
window.dispatchEvent(new CustomEvent('app:result', {
  detail: {
    type: 'calculation',
    input: '15% của 2 triệu',
    result: 300000,
    verified: true
  }
}));
```

Host giữ `recentResults[]`. AI context đọc danh sách này.

AI KHÔNG tự tính nếu app có engine xác thực. Nó phải gọi adapter/tool của app.

## 7. Feedback trong AI Panel

Không tạo màn hình Feedback riêng nếu AI Panel đã tồn tại.

Panel:
`Chat | Feedback | Settings | Logs`

Feedback tab phải có:
- notices
- unread count
- loại feedback
- rating
- ô nhập
- gửi
- donate/support info từ Hub

Khi sync:
`unread = số notice chưa đọc`

Nút AI:
`AI image + badge unread`

Khi người dùng mở/xem và mark-read:
`badge giảm về 0 → ẩn`.

## 8. Donate / Support

Không fix cứng:
- wallet
- username
- URL
- QR
- address
- message

Luôn lấy `policy.donate` từ Feedback Hub.

Nếu Hub bổ sung field mới, renderer nên hiển thị field string an toàn thay vì phải sửa từng app.

## 9. Settings

Settings nằm trong AI Panel.

Tối thiểu:
- Provider
- API Key
- Base URL
- Model
- Mode
- Save
- AI status

API key:
- input password
- không hiển thị full sau Save
- không log
- không đưa vào frontend state lâu dài
- file permission 0600

## 10. Logs

Một log chung cho app + module.

Nên ghi:
- server start/stop
- AI request metadata (provider/model, không key)
- provider error
- HTTP status
- app action result
- feedback send/sync result
- unexpected exception
- repair/diagnostic event

Không ghi:
- API key
- ingest token
- password
- cookies
- authorization header
- private user content nếu không cần.

## 11. Cổng / SoloHost

Module KHÔNG tự cố định public host port.

Host app:
```yaml
services:
  app:
    image: ...
    restart: unless-stopped
    ports:
      - "8080"
```

Server:
```js
const PORT = Number(process.env.PORT || 8080);
server.listen(PORT, '0.0.0.0');
```

Không dùng:
`127.0.0.1:18080:8080`
nếu mục tiêu là để SoloHost tự cấp public host port.

Không dùng docker.sock.

Không tạo container phụ cho AI/Feedback.

## 12. API contract chuẩn

AI:
- GET `/api/ai/status`
- GET `/api/ai/catalog`
- GET `/api/ai/settings`
- POST `/api/ai/settings`
- POST `/api/ai/chat`
- GET `/api/logs`
- DELETE `/api/logs`

Feedback:
- GET `/api/feedback/config`
- GET `/api/feedback/sync?anonymous_id=...`
- POST `/api/feedback`
- POST `/api/feedback/read/:id`

## 13. Khi app đã có AI/Feedback

AI code PHẢI làm theo thứ tự:

1. Scan source.
2. Tìm provider/router hiện tại.
3. Tìm AI UI/FAB.
4. Tìm settings/key storage.
5. Tìm logs.
6. Tìm feedback client/server.
7. Tìm Hub URL/token.
8. Xác định chức năng trùng.
9. Giữ hệ thống tốt hơn.
10. Gộp adapter vào Universal Module.
11. Xóa đường gọi trùng.
12. Chạy tests.
13. Test Provider → Refresh Models → Chat.
14. Test bằng model `auto`; sau đó thử một model cũ/không tồn tại để xác nhận stale-model recovery.
15. Kiểm tra action allowlist và confirmation.
13. Kiểm tra browser console.
14. Kiểm tra API routes.
15. Kiểm tra SoloHost container.
16. Chỉ sau đó báo DONE.

KHÔNG:
- xây hệ thống AI thứ hai cạnh hệ thống cũ
- tạo Feedback Hub thứ hai
- đổi UI chính
- đổi calculator/business logic nếu không liên quan.

## 14. Acceptance checklist

AI:
- [ ] provider catalog hiển thị
- [ ] key không lộ
- [ ] custom provider chạy
- [ ] local provider chạy
- [ ] history hoạt động
- [ ] app knowledge đúng
- [ ] live context đúng
- [ ] action whitelist
- [ ] action result xác nhận
- [ ] explain result
- [ ] logs

Feedback:
- [ ] token không xuất hiện browser
- [ ] sync notices
- [ ] unread badge
- [ ] mark read
- [ ] feedback submit
- [ ] donate lấy từ Hub
- [ ] offline/error không làm app crash

SoloHost:
- [ ] server bind `0.0.0.0`
- [ ] container port chỉ là container port
- [ ] không docker.sock
- [ ] health/test endpoint
- [ ] model discovery / Refresh endpoint
- [ ] stale-model recovery tested
- [ ] restart policy
- [ ] data persistent

## 15. Prompt chuẩn cho AI code tích hợp

> SCAN FIRST. Do not rebuild the app.
>
> Scan the complete source and identify any existing AI, provider router, settings, key storage, logs, Feedback Hub client/server, AI button, panel, history, help system and app action system.
>
> Integrate the Universal AI + Feedback modules from this package.
>
> Preserve the existing app UI and business logic. There must be exactly one AI system and one Feedback system. If an existing implementation already provides a capability, merge/upgrade it instead of creating a duplicate.
>
> AI must understand the app through an App Adapter containing static knowledge, live context, safe whitelisted actions and recent history. It must explain actual app results and may operate the app only through validated actions.
>
> AI must support every provider exposed by the module, including Custom and Local OpenAI-compatible endpoints.
>
> Put AI Settings, Feedback and Logs inside the existing AI panel. Keep one AI button only. The button may use the supplied AI image and must not disturb the main UI.
>
> Feedback must use the supplied server-side Feedback Hub module. Never expose the ingest token to browser JavaScript. Notices must drive the unread badge on the single AI button; marking notices read must remove the badge when none remain. Donate information must come from the Hub and must never be hard-coded.
>
> Store AI keys server-side, masked in UI, never log them.
>
> Do not use docker.sock, privileged mode, fixed public host ports, or destructive commands.
>
> Before finalizing, test all API routes, provider settings, feedback sync/send/read, badge behavior, action validation, logs, browser console, and SoloHost startup.
>
> Report exactly: files changed, features completed, tests passed, known limitations, and rollback point.

## 16. File layout recommended

```text
app/
  server.js
  lib/
    ai-module/
    feedback-module/
    app-adapter.js
  public/
    ai-module/
    feedback-module/
    ai-icon.png
  data/
    ai-settings.json
    app.log
```

Không bắt buộc đúng tên thư mục; API contract mới là chuẩn.


## Provider recovery — BẮT BUỘC

Không hard-code một model duy nhất cho `auto`. Universal AI Module dùng:
1. `GET /api/ai/models` để hỏi provider danh sách model hiện có.
2. Chọn model phù hợp từ danh sách.
3. Chat bằng model đã phát hiện.
4. Nếu model đã lưu trả `404`/model-not-found, module refresh danh sách, chọn model mới, retry **một lần** và lưu model mới.
5. Nếu lỗi `401/403/429` thì không retry vô hạn; trả lỗi chẩn đoán rõ ràng và ghi log đã redact.

`POST /api/ai/test` kiểm tra credential + endpoint bằng Model API; đây là kiểm tra kết nối, không giả vờ rằng mọi model đều có thể generate.

Google Gemini hiện có Model API để liệt kê model và `supportedGenerationMethods`; module chỉ chọn model có `generateContent` khi metadata cung cấp trường này. Google cũng phân biệt API `v1` ổn định với `v1beta`.

## Action security

Không gửi danh sách action từ browser vào AI Gateway. Action registry phải nằm server-side trong `adapter.actions` hoặc `options.actions`. Mỗi action phải có tên duy nhất; action có `requiresConfirmation:true` chỉ được thực thi khi host gửi xác nhận tương ứng.


## 17. Lessons from Snake Arcade (production)

1. **Offline chat**: implement `adapter.localReply(message, live)`. The AI service calls it when no provider/key is configured so Chat is never empty.
2. **Donate shape**: Hub returns nested objects (`pi_wallet`, `mb_account`, …). Flatten objects/arrays in the UI; do not only read top-level strings.
3. **Badge**: `setUnread(0)` must hide the badge and clear text — never display the digit `0`.
4. **FAB vs panel**: hide the AI button while the panel is open so it does not cover the panel close control.
5. **Token**: remove any `/api/shfh-config` that returned `ingestToken` to the browser. Use only `/api/feedback/config` (public) + server-side Hub calls.
6. **Env override**: only set `fbOpts.hubId/baseUrl/ingestToken` when the env var is non-empty; spreading `undefined` overwrites module defaults.
7. **Express test shims**: if tests mock Express, implement `app.delete` for `DELETE /api/logs`.
8. **One mount point**: delete previous ai-bridge / provider-hub / shfh-client dual stacks before shipping.

## 18. File checklist for host app

```
lib/ai-module/ai-service.js
lib/ai-module/provider-engine.js
lib/ai-module/routes.js
lib/feedback-module/feedback-service.js
lib/app-adapter.js
public/ai-module/ai-module.js
public/feedback-module/feedback-module.js
public/ai-panel.js          (host-owned UI)
public/ai-icon.png          (optional)
data/.gitkeep
```

See also: `AI_CODE_PROMPT.md` for a full prompt you can paste into another coding AI.


## 18. Custom / Local provider troubleshooting (v1.3.0)

| Symptom | Meaning | Fix |
|---|---|---|
| `Provider returned no usable text model` (`NO_MODEL`) | Server lists no chat model on `/models` | Type the model name in Settings → Model, Save |
| `non-JSON response (an HTML page)` (`BAD_BASE_URL`) | Base URL points at a web UI, not the API | Use the API root, e.g. `http://host:port/v1` |
| `Connection refused` (`NETWORK_ERROR`) | Server down / wrong port / Docker localhost | Start server; in Docker use `host.docker.internal` |
| `timed out` (`TIMEOUT`) | Model still loading | Retry; raise `AI_TIMEOUT_MS` |
| `returned no final text … reasoning` (`EMPTY_RESPONSE`) | Reasoning model used its whole budget | Use a non-reasoning model or raise server max tokens |

`Check token` on Custom/Local performs a real tiny generation, so a green result means chat will work.

