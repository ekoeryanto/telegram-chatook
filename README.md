# Telegram-Chatwoot Bridge

A runnable boilerplate for bridging Telegram and Chatwoot, built with Bun + TypeScript + Elysia.

**⚠️ Note:** This is scaffolding only. No forwarding logic is implemented yet.

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

1. Set `CHATWOOT_WEBHOOK_TOKEN` in your `.env`
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

## Development Notes

- All database queries use Knex parameterized queries (no SQL injection risk)
- Telegram messages are logged but not forwarded yet
- Chatwoot webhooks are validated and logged but not processed
- Bearer auth is optional and skipped for `/healthz`

## Next Steps (Not Implemented)

- [ ] Telegram → Chatwoot message forwarding
- [ ] Chatwoot → Telegram message forwarding
- [ ] Contact/conversation mapping logic
- [ ] Media handling
- [ ] Error recovery and retry logic

## License

MIT