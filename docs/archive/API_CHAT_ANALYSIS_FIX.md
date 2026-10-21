# Phân tích lỗi gọi AI qua Personal AI Hub API + bản sửa

## Kết luận

**Lỗi nằm ở Personal AI Hub (lớp OpenAI-compatible), không phải module AI-feedback.**

Module Universal AI (calculator / SoloHost panel) gọi đúng chuẩn OpenAI:

- `POST {baseUrl}/chat/completions` với `Authorization: Bearer …`
- Đọc `choices[0].message.content`
- Nếu content rỗng → coi là lỗi provider

Hub khi chat thất bại nội bộ (`NO_ACTIVE_KEY`, `ALL_PROVIDERS_FAILED`, …) vẫn trả:

- HTTP **200**
- `choices[0].message.content = ""`
- Thông tin lỗi chỉ nằm trong object kernel (`result.error` / `result.message`) **không** được map ra HTTP error OpenAI

→ Client (module AI) nhận “thành công nhưng không có text” → báo *returned no text content* / không gọi được AI, dù Hub biết rõ nguyên nhân.

Khi chat **thành công**, Hub trả JSON chuẩn OpenAI (`object: chat.completion`, `choices[].message.content` string) — **đúng chuẩn**, module parse được (kể cả khi model trả plain text thay vì JSON actions).

## Không phải lỗi format “văn bản lạ”

- Không phải Hub trả plain text thay vì JSON.
- Không phải module yêu cầu schema lạ ngoài OpenAI chat completions.
- Module còn fallback: `reply = parsed?.reply || raw` nếu model không trả JSON actions.

## Bản sửa (Hub v1.8.2)

File: `openai-compat.js`

1. **`POST /v1/chat/completions`** (và alias `/openai/v1/...`):
   - Nếu `result.error` → HTTP 503/429/401/502 + body:
     ```json
     { "error": { "message": "...", "type": "api_error", "code": "NO_ACTIVE_KEY|...", "request_id": "..." } }
     ```
   - Nếu không error nhưng `reply` rỗng → HTTP 502, code `EMPTY_ASSISTANT_CONTENT`.
   - Chỉ khi có nội dung assistant thật mới trả 200 + `choices[0].message.content`.

2. **`POST /v1/responses`**: cùng logic map lỗi (tránh empty `output_text`).

Client OpenAI-compatible (Universal AI module, SDK, curl) sẽ nhận đúng mã lỗi và message hữu ích (vd. “No usable AI key…”) thay vì content rỗng.

## Hướng dẫn cấu hình app → Hub

- Provider: **Custom** hoặc **Local**
- Base URL: `http://<hub-host>:<port>/v1` (bắt buộc có `/v1`)
- API Key: gateway token `pah_…` (Bearer)
- Model: `auto` hoặc id từ `GET /v1/models`

## Việc vẫn cần ở phía vận hành Hub

- Có ít nhất một provider key **ACTIVE** (Settings → Test / refresh models).
- Gemini free-tier: ưu tiên flash; DeepSeek cần balance; Ollama local phải reachable từ container.

## Kiểm tra nhanh sau nâng cấp

```bash
# Không có key / key lỗi → phải 503 + error.message, KHÔNG được 200 content rỗng
curl -sS -o /tmp/out -w "%{http_code}" -X POST "$HUB/v1/chat/completions" \
  -H "Authorization: Bearer $PAH_TOKEN" -H "Content-Type: application/json" \
  -d '{"model":"auto","messages":[{"role":"user","content":"hi"}]}'
cat /tmp/out
```
