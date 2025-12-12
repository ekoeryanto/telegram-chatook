# Telegram-Chatwoot Bridge

A runnable boilerplate for bridging Telegram and Chatwoot, built with Bun + TypeScript + Elysia.

**Status:** Bidirectional forwarding implemented.

- Telegram → Chatwoot: incoming private messages create/find contact + conversation and post messages.
- Chatwoot → Telegram: outgoing messages (via webhook) are forwarded back to the original Telegram user.
- Conversation de-duplication: lists inbox conversations and filters locally; sets `source_id` to `telegram_{id}`.
- Contact sync: updates Chatwoot contact name/phone when Telegram profile changes.

## Features

- ✅ Elysia HTTP server with CORS, Swagger, and bearer auth
- ✅ Telegram client using GramJS
- ✅ SQL Server database with Knex migrations & seeds
- ✅ Structured logging with Pino
- ✅ Chatwoot webhook receiver
- ✅ Basic database endpoints
- ✅ Docker support

## Prerequisites

- [Bun](https://bun.sh) runtime installed
- SQL Server instance (local or remote)
- Telegram API credentials (get from https://my.telegram.org)
- Chatwoot instance (optional for basic testing)

## Quick Start

### 1. Install dependencies

```bash
bun install
```

### 2. Generate Telegram session

Run the interactive login script to generate your `TG_SESSION` string:

```bash
bun run login
```

Follow the prompts to enter your API ID, API Hash, phone number, and verification code. Copy the session string output.

### 3. Configure environment

Copy the example environment file and fill in your credentials:

```bash
cp .env.example .env
```

Edit `.env` and set:
- `TG_API_ID` and `TG_API_HASH` from my.telegram.org
- `TG_SESSION` from the login script output
- SQL Server connection details (`DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`)
- Chatwoot settings (optional)
- `API_BEARER_TOKEN` for API authentication (optional)

### 4. Run database migrations & seeds

```bash
bun run db:migrate
bun run db:seed
```

This creates the `bridge.customer_demo` table and inserts 2 sample rows.

### 5. Start development server

```bash
bun run dev
```

The server will start on port 3000 (or your configured `PORT`).

## Testing Endpoints

Once running, test the following endpoints:

- **Health check:** `GET http://localhost:3000/healthz`
- **API docs:** `GET http://localhost:3000/docs` (Swagger UI)
- **Database ping:** `GET http://localhost:3000/db/ping`
- **Get customers:** `GET http://localhost:3000/db/customers`
- **Get customer by ID:** `GET http://localhost:3000/db/customer/1`
- **Chatwoot webhook:** `POST http://localhost:3000/webhooks/chatwoot`

### Secure Telegram Channel/Chat Sender

- **Send to channel/chat:** `POST http://localhost:3000/telegram/send-channel`
- Requires header: `Authorization: Bearer <API_BEARER_TOKEN>`

Example (public channel by handle):

```bash
curl -X POST http://localhost:3000/telegram/send-channel \
	-H "Authorization: Bearer $API_BEARER_TOKEN" \
	-H "Content-Type: application/json" \
	-d '{"channel":"mychannelhandle","message":"Hello channel!"}'
```

Example (chat/channel by id string):

```bash
curl -X POST http://localhost:3000/telegram/send-channel \
	-H "Authorization: Bearer $API_BEARER_TOKEN" \
	-H "Content-Type: application/json" \
	-d '{"channel":"1234567890","message":"Hello by ID!"}'
```

If `API_BEARER_TOKEN` is set, include header: `Authorization: Bearer <token>`

## Project Structure

```
.
├── src/
│   ├── index.ts              # Main entry point
│   ├── server.ts             # Elysia HTTP server
│   ├── db/
│   │   └── knex.ts          # Database connection
│   ├── telegram/
│   │   └── client.ts        # Telegram client
│   └── chatwoot/
│       └── api.ts           # Chatwoot API wrapper
├── db/
│   ├── migrations/          # Knex migrations
│   └── seeds/               # Knex seeds
├── scripts/
│   └── login.ts            # Telegram login helper
├── knexfile.ts             # Knex configuration
├── .env.example            # Environment template
└── Dockerfile              # Docker image
```

## Scripts

- `bun run dev` - Start with hot reload
- `bun run start` - Start production mode
- `bun run login` - Interactive Telegram login
- `bun run db:migrate` - Run database migrations
- `bun run db:seed` - Run database seeds

## Local Development with Tunneling

For testing webhooks from Chatwoot, you need to expose your local server using a tunnel service:

### Option 1: Cloudflare Tunnel (Recommended)
```bash
# Install cloudflared
brew install cloudflared

# Run tunnel
cloudflared tunnel --url http://localhost:3000
```

### Option 2: ngrok
```bash
# Install ngrok
brew install ngrok

# Run tunnel
ngrok http 3000
```

### Option 3: localtunnel
```bash
# Install via npm
npm install -g localtunnel

# Run tunnel
lt --port 3000
```

Copy the public URL provided by the tunnel service (e.g., `https://abc123.trycloudflare.com`).

## Chatwoot Webhook Setup

To receive Chatwoot webhooks:

1. Set `CHATWOOT_WEBHOOK_TOKEN` in your `.env` (required to validate incoming webhooks)
2. In Chatwoot admin, configure webhook URL: `https://your-tunnel-url.com/webhooks/chatwoot`
3. Add custom header: `x-webhook-token: <your-token>`

**Example with tunnel:**
- Webhook URL: `https://abc123.trycloudflare.com/webhooks/chatwoot`
- Custom header: `x-webhook-token: my-secret-token-123`

## Docker

Build and run with Docker:

```bash
docker build -t telegram-chatwoot .
docker run -p 3000:3000 --env-file .env telegram-chatwoot
```

## Security Notes

- Do not commit `.env`. It is ignored via `.gitignore`.
- Chatwoot REST calls use `api_access_token` per-request.
- Webhooks must include `x-webhook-token` that matches `CHATWOOT_WEBHOOK_TOKEN`.
- `POST /telegram/send-channel` always requires `Authorization: Bearer <API_BEARER_TOKEN>`. If the token is not configured, the route refuses usage.

## Development Notes

- All database queries use Knex parameterized queries (no SQL injection risk)
- Telegram and Chatwoot forwarding are active.
- Webhooks are validated and fetch conversation details when `source_id` is missing.
- Bearer auth is optional globally but enforced on `/telegram/send-channel`.

## Next Steps

- [ ] Media handling (photos, documents)
- [ ] Rich formatting
- [ ] Robust retry/backoff
- [ ] Optional polling fallback when webhook/tunnel is down

## License

MIT