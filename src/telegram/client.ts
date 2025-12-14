import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { NewMessage } from "telegram/events/index.js";
import type { Logger } from "pino";
import { ChatwootAPI } from "../chatwoot/api.js";

export interface TelegramService {
  client: TelegramClient;
  stop: () => Promise<void>;
}

export type TelegramClientType = TelegramClient;

export async function startTelegram(logger: Logger, chatwoot?: ChatwootAPI): Promise<TelegramService> {
  const apiId = parseInt(process.env.TG_API_ID || "");
  const apiHash = process.env.TG_API_HASH || "";
  const session = process.env.TG_SESSION || "";

  if (!apiId || !apiHash) {
    throw new Error("TG_API_ID and TG_API_HASH must be set");
  }

  const stringSession = new StringSession(session);
  const client = new TelegramClient(stringSession, apiId, apiHash, {
    connectionRetries: 5,
  });

  await client.connect();
  logger.info("Telegram client connected");

  // Incoming message listener
  client.addEventHandler(async (event: any) => {
    try {
      const message = event.message;

      // Only handle text messages
      if (!message?.text || !message.peerId) {
        return;
      }

      // Check if message is from a group/channel
      const isGroup = message.isGroup || message.isChannel;
      const ignoreGroups = process.env.CHATWOOT_IGNORE_GROUP === 'true';

      if (isGroup && ignoreGroups) {
        logger.debug({ peerId: message.peerId }, "Skipping group/channel message (CHATWOOT_IGNORE_GROUP=true)");
        return;
      }

      const sender = await message.getSender();
      const senderId = sender?.id?.toString();
      const username = sender?.username || "";
      const firstName = sender?.firstName || "";
      const lastName = sender?.lastName || "";
      const phone = sender?.phone || "";
      const text = message.text;

      logger.info(
        {
          senderId,
          username,
          firstName,
          lastName,
          isGroup,
          text: text.substring(0, 100),
        },
        "Telegram message received"
      );

      // Forward to Chatwoot if API is configured
      if (chatwoot) {
        try {
          await forwardToCharwoot(chatwoot, logger, senderId, username, firstName, lastName, phone, text);
        } catch (error) {
          logger.error({ error }, "Failed to forward message to Chatwoot");
        }
      }
    } catch (error) {
      logger.error({ error }, "Error handling Telegram message");
    }
  }, new NewMessage({}));

  const stop = async () => {
    logger.info("Stopping Telegram client");
    await client.disconnect();
  };

  return { client, stop };
}

async function forwardToCharwoot(
  chatwoot: ChatwootAPI,
  logger: Logger,
  senderId: string,
  username: string,
  firstName: string,
  lastName: string,
  phone: string,
  text: string
) {
  const inboxId = process.env.CHATWOOT_INBOX_ID || "1";

  try {
    logger.info({ senderId, username, firstName, lastName }, "Starting forward to Chatwoot");

    // Build contact name: prefer firstName + lastName, fallback to username or "Telegram User"
    const fullName = [firstName, lastName].filter(Boolean).join(" ").trim() || username || "Telegram User";

    // Create or get contact
    logger.info("Creating contact...");
    const contact = await chatwoot.createContact({
      identifier: `telegram_${senderId}`,
      name: fullName,
      phone_number: phone || undefined,
    });
    logger.info({ contactId: contact.id }, "Contact created/found in Chatwoot");
    const contactId = contact?.id || contact?.contact_id || contact?.contact?.id;
    if (!contactId) {
      throw new Error("Contact creation/search returned no id");
    }

    // If existing contact has outdated fields, update them
    try {
      const currentName: string | undefined = contact?.name || contact?.contact?.name;
      const currentPhone: string | undefined = contact?.phone_number || contact?.contact?.phone_number;
      const desiredName = fullName;
      // Only send phone if non-empty and in E.164 format (starts with +)
      const desiredPhone = (phone || "").trim();
      const isValidPhone = desiredPhone && desiredPhone.startsWith("+");

      const needsNameUpdate = !!desiredName && desiredName.trim() && desiredName.trim() !== (currentName || "").trim();
      const needsPhoneUpdate = !!isValidPhone && desiredPhone !== (currentPhone || "").trim();

      if (needsNameUpdate || needsPhoneUpdate) {
        logger.info({ contactId, needsNameUpdate, needsPhoneUpdate }, "Updating existing Chatwoot contact");
        await chatwoot.updateContact(contactId, {
          name: needsNameUpdate ? desiredName : undefined,
          phone_number: needsPhoneUpdate ? desiredPhone : undefined,
        });
      }
    } catch (updateErr) {
      logger.warn({ updateErr, contactId }, "Contact update skipped or failed");
    }

    logger.info({ contactId }, "Contact created/found in Chatwoot");

    // Create conversation
    logger.info("Creating conversation...");
    const conversation = await chatwoot.createConversation({
      contact_id: contactId.toString(),
      inbox_id: inboxId,
      source_id: `telegram_${senderId}`,
    });
    logger.info({ conversationId: conversation.id }, "Conversation created/found in Chatwoot");
    const conversationId = conversation?.id || conversation?.conversation_id;
    if (!conversationId) {
      throw new Error("Conversation creation returned no id");
    }

    logger.info({ conversationId }, "Conversation created/found in Chatwoot");

    // Create message
    logger.info("Creating message...");
    await chatwoot.createMessage(conversationId.toString(), {
      content: text,
      message_type: "incoming",
    });

    logger.info({ conversationId }, "✅ Message forwarded to Chatwoot successfully");
  } catch (error: any) {
    logger.error(
      {
        error: error.message,
        stack: error.stack,
        senderId,
        username,
      },
      "❌ Failed to forward message to Chatwoot"
    );
    throw error;
  }
}

