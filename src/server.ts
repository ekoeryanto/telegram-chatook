import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { swagger } from "@elysiajs/swagger";
import { bearer } from "@elysiajs/bearer";
import { z } from "zod";
import { db, dbPing } from "./db/knex.js";
import type { Logger } from "pino";
import type { TelegramClientType } from "./telegram/client.js";
import { createChatwootAPI } from "./chatwoot/api.js";

const chatwootWebhookSchema = z.object({
  event: z.string().optional(),
  message_type: z.string().optional(),
  content: z.string().optional(),
  conversation: z
    .object({
      id: z.number().optional(),
      source_id: z.string().optional(),
    })
    .optional(),
});

export function createServer(logger: Logger, telegramClient?: TelegramClientType) {
  const app = new Elysia()
    .use(cors())
    .use(
      swagger({
        path: "/docs",
        documentation: {
          info: {
            title: "Telegram-Chatwoot Bridge API",
            version: "1.0.0",
          },
        },
      })
    );

  // Bearer auth middleware (applied conditionally)
  if (process.env.API_BEARER_TOKEN) {
    app.use(bearer()).derive(({ bearer, path }) => {
      // Skip auth for healthz endpoint
      if (path === "/healthz") {
        return {};
      }

      if (!bearer || bearer !== process.env.API_BEARER_TOKEN) {
        throw new Error("Unauthorized");
      }
      return {};
    });
  }

  app
    // Health check endpoint
    .get("/healthz", () => {
      return { ok: true };
    })

    // Database ping endpoint
    .get("/db/ping", async () => {
      try {
        await dbPing();
        logger.info("Database ping successful");
        return { ok: true };
      } catch (error) {
        logger.error({ error }, "Database ping failed");
        throw new Error("Database ping failed");
      }
    })

    // Get customer by ID
    .get("/db/customer/:id", async ({ params }) => {
      const { id } = params;
      logger.info({ customerId: id }, "Fetching customer by ID");

      const customer = await db("bridge.customer_demo")
        .where({ id: parseInt(id) })
        .first();

      if (!customer) {
        throw new Error("Customer not found");
      }

      return customer;
    })

    // Get all customers
    .get("/db/customers", async () => {
      logger.info("Fetching all customers");

      const customers = await db("bridge.customer_demo")
        .orderBy("created_at", "desc")
        .limit(50);

      return { customers, count: customers.length };
    })

    // Chatwoot webhook receiver
    .post("/webhooks/chatwoot", async ({ body, headers, query }) => {
      // Validate webhook token if configured
      // Support both header (x-webhook-token) and query parameter (token=...)
      if (process.env.CHATWOOT_WEBHOOK_TOKEN) {
        const headerToken = headers["x-webhook-token"];
        const queryToken = (query as any)?.token;
        const token = headerToken || queryToken;

        if (token !== process.env.CHATWOOT_WEBHOOK_TOKEN) {
          logger.warn({ headerToken: !!headerToken, queryToken: !!queryToken }, "Invalid webhook token");
          throw new Error("Unauthorized");
        }
      }

      try {
        const parsed = chatwootWebhookSchema.parse(body);
        logger.info(
          {
            event: parsed.event,
            messageType: parsed.message_type,
            conversationId: parsed.conversation?.id,
            sourceId: parsed.conversation?.source_id,
            contentPreview: parsed.content?.substring(0, 50),
          },
          "Chatwoot webhook received"
        );

        // Forward Chatwoot -> Telegram (outgoing/public messages)
        if (telegramClient && parsed.message_type === "outgoing" && parsed.content) {
          let sourceId =
            parsed.conversation?.source_id ||
            (parsed as any)?.conversation?.contact_inbox?.source_id ||
            (parsed as any)?.conversation?.additional_attributes?.source_id;

          try {
            // If webhook payload lacks source_id, fetch conversation detail (v4.8)
            if (!sourceId && parsed.conversation?.id) {
              const cw = createChatwootAPI();
              const convo = await cw.getConversation(String(parsed.conversation.id));
              sourceId =
                convo?.source_id ||
                convo?.contact_inbox?.source_id ||
                convo?.additional_attributes?.source_id;
              logger.info({ fetchedSourceId: sourceId }, "Fetched conversation source_id from Chatwoot");
            }

            if (sourceId && sourceId.startsWith("telegram_")) {
              const telegramId = sourceId.replace("telegram_", "");
              try {
                await telegramClient.sendMessage(telegramId, { message: parsed.content });
              } catch (_err) {
                logger.error({ _err, telegramId }, "Failed to send message to Telegram");
              }
              logger.info({ telegramId }, "Forwarded Chatwoot message to Telegram");
            } else {
              logger.warn({ sourceId, convoId: parsed.conversation?.id }, "Skipping forward: missing or non-telegram source_id");
            }
          } catch (err) {
            logger.error({ err, sourceId, convoId: parsed.conversation?.id }, "Failed to forward Chatwoot message to Telegram");
          }
        }

        return { ok: true };
      } catch (error) {
        logger.error({ error, body }, "Invalid webhook payload");
        throw new Error("Invalid webhook payload");
      }
    });

  // Send message to a Telegram channel or chat
  app.post("/telegram/send-channel", async ({ body, headers }) => {
    // Require bearer token explicitly for this endpoint, regardless of global middleware
    const expectedToken = process.env.API_BEARER_TOKEN;
    if (!expectedToken) {
      // If no token configured, refuse to serve this sensitive endpoint
      throw new Error("API_BEARER_TOKEN must be set to use this endpoint");
    }
    const authHeader = headers["authorization"] || headers["Authorization"];
    const providedToken = typeof authHeader === "string" && authHeader.startsWith("Bearer ")
      ? authHeader.replace(/^Bearer\s+/i, "")
      : undefined;
    if (!providedToken || providedToken !== expectedToken) {
      throw new Error("Unauthorized");
    }
    if (!telegramClient) {
      throw new Error("Telegram client not initialized");
    }

    const schema = z.object({
      channel: z.string().min(1), // username without @ or numeric id
      message: z.string().min(1),
    });

    const parsed = schema.parse(body);
    const { channel, message } = parsed;

    try {
      let peer: any = channel;
      // Resolve entity if looks like a username (no digits only), otherwise try id string
      if (typeof channel === "string") {
        try {
          peer = await telegramClient.getEntity(channel.replace(/^@/, ""));
        } catch (resolveErr) {
          // Fallback: use raw channel string (may be numeric ID the client can handle)
          logger.warn({ resolveErr, channel }, "Failed to resolve entity, using raw channel");
          peer = channel;
        }
      }

      await telegramClient.sendMessage(peer, { message });
      logger.info({ channel }, "Sent message to Telegram channel/chat");
      return { ok: true };
    } catch (err: any) {
      logger.error({ err, channel }, "Failed to send message to Telegram channel/chat");
      throw new Error(`Failed to send: ${err?.message || "unknown error"}`);
    }
  });

  return app;
}
