# v1.8.14 — Professional local provider metadata

## OpenAI-compatible model catalog (`GET /v1/models`)
Each model entry includes:
- context_window, max_output_tokens
- supports_json, supports_tools, supports_vision, supports_reasoning, supports_streaming
- latency_ms (estimate), health (ready|loaded|cold|…)
- loaded (local), size_bytes, family, parameter_size, quantization
- hub.local: available, cold_start, loaded_count, memory

## Local Ollama enrichment
- /api/tags + /api/ps (loaded models) + /api/show (context when available)
- cold_start when models installed but none loaded
- memory.loaded_bytes / loaded_vram_bytes

## Public IP
- Still auto-detected dynamically — never hard-coded to a fixed user IP
- 14.176.78.46 appears only as Feedback Hub URL (unrelated to gateway)

## Tests
- test.js, test-security, test-smart-router PASS
