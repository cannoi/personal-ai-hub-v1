# SoloHost / remote AI Gateway

## Fixed public endpoint

| Item | Value |
|------|--------|
| Host port | **59971** (mapped to container 8080) |
| OpenAI Base URL | `http://YOUR_PUBLIC_IP:59971/v1` |
| Models | `GET /v1/models` |
| Chat | `POST /v1/chat/completions` |
| API Key | `pah_…` (Hub → Gateway tokens) |
| Model | `auto` |

Optional SoloHost config:

- `HOST_PORT=59971` (default)
- `PUBLIC_BASE_URL=http://YOUR_PUBLIC_IP:59971` (no trailing `/v1`)

## App Builder

1. Type: OpenAI-compatible / Custom  
2. Base URL: `http://YOUR_PUBLIC_IP:59971/v1`  
3. API Key: create in Hub UI (shown once)  
4. Model: `auto`

## Token monitoring

Hub lists each `pah_` token with:

- Client count (machines/apps seen)
- Today / total requests & tokens
- Bound appId
- **Delete** to revoke

## Do not use

- `http://127.0.0.1:…` from another container  
- Base URL without `/v1`
