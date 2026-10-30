# Personal AI Hub v1.8.5 — Universal OpenAI-Compatible Gateway Contract

## Mục tiêu
Chuẩn hóa Personal AI Hub thành một AI Gateway có thể đấu nối dễ dàng với app bên thứ ba bằng contract OpenAI-compatible, đồng thời giữ nguyên AI kernel, routing, provider management, Local AI, authentication, fallback và usage control hiện có.

## Đã thực hiện

### 1. Chuẩn hóa public API
- `GET /v1/models`
- `POST /v1/chat/completions`
- `POST /v1/responses`
- `POST /v1/embeddings`
- `GET /v1/health`
- Giữ `/v1/__ping` và các alias `/openai/v1/*` để tương thích ngược.

### 2. OpenAI-compatible response contract
- Chat thành công trả `object: chat.completion`, `choices[].message.role/content`, `finish_reason`, `usage`, `id`, `model`.
- Chat lỗi trả HTTP non-2xx với object `error`, thay vì HTTP 200 + nội dung rỗng.
- Streaming trả SSE `chat.completion.chunk` và `[DONE]`; hỗ trợ `stream_options.include_usage`.
- Responses API trả `object: response`, `output[].content[].type=output_text`, `output_text`, `status`, `usage`.
- Embeddings trả `object: list`, `data[].object=embedding`, `index`, `embedding`, `usage`.
- `X-Request-Id` được duy trì trên các response chính.

### 3. Universal input normalization
- Chat nhận content dạng string hoặc content blocks text.
- Responses API nhận input string hoặc input message array; hỗ trợ `instructions`.
- Model selector hỗ trợ `auto` và provider/model dạng `provider/model`, bao gồm Local, OpenAI, Gemini, DeepSeek, Groq, OpenRouter, Anthropic, Mistral, xAI và Custom.

### 4. Custom/OpenAI-compatible provider normalization
Provider response không còn bắt buộc `choices[0].message.content` phải là string. Hub chuẩn hóa:
- string content
- text content blocks
- `choices[].text`
- `output_text`
- một số output/content block dạng Responses API

Điều này trực tiếp giảm lỗi kiểu `Provider returned no usable text mode` ở các client/custom provider có response hợp lệ nhưng khác dạng string đơn.

### 5. Authentication / usage / fallback
Giữ nguyên gateway token, app binding, rate limit, concurrent limit, daily/monthly token quota, usage recording và routing/fallback hiện có. Không thay đổi execution plane của AI kernel.

## Giữ nguyên
- Provider registry và provider-specific adapters.
- Local AI/Ollama.
- Smart routing/fallback.
- Admin authentication/control plane.
- Encrypted backup/restore.
- Universal AI + Feedback module.
- SoloHost packaging/configuration.
- Existing `/api/v1/*` internal compatibility routes.

## Thay đổi bắt buộc
- `openai-compat.js`: chuẩn hóa contract/input/error/streaming.
- `ai-app-kernel/src/providers.js`: chuẩn hóa text output của OpenAI-compatible provider.
- `package.json`, `package-lock.json`, `index.js`: bump version/advertised gateway version lên `1.8.5`.
- Thêm `test-openai-contract.js` để kiểm tra contract và content-block normalization.

## Chưa làm / ngoài phạm vi
- Không biến mọi provider thành OpenAI Responses API native ở upstream; Hub tiếp tục adapter hóa từng provider về contract chung.
- Không thêm tool/function calling, vision/audio, realtime/WebSocket hoặc multimodal binary streaming trong giai đoạn này vì kernel hiện tại chưa có execution contract tương ứng.
- Không thay đổi UI/provider settings ngoài mức cần thiết cho gateway contract.

## Kiểm tra
- Syntax check toàn bộ JS/CJS.
- Existing test suite.
- Gateway auth/usage tests.
- OpenAI-compatible contract tests.
- Custom provider content-block normalization test.
- ZIP integrity và loại trừ data/secrets/node_modules/.git.
