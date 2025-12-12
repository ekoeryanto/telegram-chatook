import localtunnel from "localtunnel";
import * as dotenv from "dotenv";

dotenv.config();

const port = parseInt(process.env.PORT || "3000");
const subdomain = process.env.TUNNEL_SUBDOMAIN;

async function startTunnel() {
  try {
    console.log(`\n🌐 Starting localtunnel...`);
    console.log(`📡 Forwarding to: http://localhost:${port}\n`);

    const options: any = { port };
    if (subdomain) {
      options.subdomain = subdomain;
      console.log(`🔑 Using subdomain: ${subdomain}`);
    }

    const tunnel = await localtunnel(options);

    console.log(`\n✅ Tunnel URL: ${tunnel.url}`);
    console.log(`\n🔗 Use this as your Chatwoot webhook URL:`);
    console.log(`   ${tunnel.url}/webhooks/chatwoot\n`);

    tunnel.on("close", () => {
      console.log("\n❌ Tunnel closed");
      process.exit(0);
    });

    tunnel.on("error", (err: any) => {
      console.error("\n❌ Tunnel error:", err.message);
      process.exit(1);
    });
  } catch (error: any) {
    console.error("❌ Failed to start tunnel:", error.message);
    process.exit(1);
  }
}

startTunnel();

// Handle graceful shutdown
process.on("SIGINT", () => {
  console.log("\n\n👋 Closing tunnel...");
  process.exit(0);
});

