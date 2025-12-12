import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import * as readline from "readline";
import * as dotenv from "dotenv";

dotenv.config();

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function question(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      resolve(answer);
    });
  });
}

async function login() {
  console.log("=== Telegram Login ===\n");

  const apiIdStr = await question("Enter your API ID: ");
  const apiId = parseInt(apiIdStr);
  const apiHash = await question("Enter your API Hash: ");

  if (!apiId || !apiHash) {
    console.error("API ID and API Hash are required");
    process.exit(1);
  }

  const stringSession = new StringSession("");
  const client = new TelegramClient(stringSession, apiId, apiHash, {
    connectionRetries: 5,
  });

  await client.start({
    phoneNumber: async () => await question("Enter your phone number (with country code, e.g., +1234567890): "),
    password: async () => await question("Enter your 2FA password (or press Enter to skip): "),
    phoneCode: async () => await question("Enter the code you received: "),
    onError: (err) => console.error("Error:", err),
  });

  console.log("\n✅ Successfully logged in!");
  console.log("\n📋 Your session string:");
  console.log(client.session.save());
  console.log("\n💾 Add this to your .env file as TG_SESSION=");

  await client.disconnect();
  rl.close();
  process.exit(0);
}

login().catch((error) => {
  console.error("Login failed:", error);
  rl.close();
  process.exit(1);
});
