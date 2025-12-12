import * as dotenv from "dotenv";
import pino from "pino";
import { db, dbPing } from "./db/knex.js";
import { startTelegram } from "./telegram/client.js";
import { createServer } from "./server.js";
import { createChatwootAPI } from "./chatwoot/api.js";

// Load environment variables
dotenv.config();

// Initialize logger
const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  transport: {
    target: "pino-pretty",
    options: {
      colorize: true,
      translateTime: "SYS:standard",
      ignore: "pid,hostname",
    },
  },
});

async function main() {
  try {
    logger.info("Starting Telegram-Chatwoot Bridge");

    // Test database connection
    logger.info("Testing database connection...");
    await dbPing();
    logger.info("✅ Database connection successful");

    // Initialize Chatwoot API (optional)
    let chatwoot;
    if (process.env.CHATWOOT_URL && process.env.CHATWOOT_API_KEY) {
      chatwoot = createChatwootAPI();
      logger.info("✅ Chatwoot API initialized");
    } else {
      logger.warn("⚠️  Chatwoot API not configured, messages won't be forwarded");
    }

    // Start Telegram client
    logger.info("Starting Telegram client...");
    const telegram = await startTelegram(logger, chatwoot);
    logger.info("✅ Telegram client started");

    // Start HTTP server
    const port = parseInt(process.env.PORT || "3000");
    const app = createServer(logger, telegram.client);
    app.listen(port);
    logger.info(`✅ HTTP server listening on port ${port}`);
    logger.info(`📖 API docs available at http://localhost:${port}/docs`);

    // Graceful shutdown
    const shutdown = async (signal: string) => {
      logger.info(`${signal} received, shutting down gracefully...`);

      try {
        // Stop HTTP server
        logger.info("Stopping HTTP server...");
        app.stop();

        // Disconnect Telegram
        logger.info("Disconnecting Telegram client...");
        await telegram.stop();

        // Destroy database connection
        logger.info("Closing database connection...");
        await db.destroy();

        logger.info("✅ Shutdown complete");
        process.exit(0);
      } catch (error) {
        logger.error({ error }, "Error during shutdown");
        process.exit(1);
      }
    };

    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));
  } catch (error) {
    logger.error({ error }, "Failed to start application");
    process.exit(1);
  }
}

main();
