import {
  createSigner,
  getEncryptionKeyFromHex,
  logAgentDetails,
  validateEnvironment,
  getDbPath,
} from "./helpers/client.ts";
import {
  Client,
  type XmtpEnv,
  type DecodedMessage,
  Conversation,
} from "@xmtp/node-sdk";
import express, { Request, Response } from "express";
import { generateResponse } from "./openAi/client";
import fetch from "node-fetch";

/* Get the wallet key associated to the public key of
 * the agent and the encryption key for the local db
 * that stores your agent's messages */
const { WALLET_KEY, ENCRYPTION_KEY, XMTP_ENV, SQUABBLE_URL } =
  validateEnvironment([
    "WALLET_KEY",
    "ENCRYPTION_KEY",
    "XMTP_ENV",
    "SQUABBLE_URL",
  ]);

/* Create the signer using viem and parse the encryption key for the local db */
const signer = createSigner(WALLET_KEY);
const dbEncryptionKey = getEncryptionKeyFromHex(ENCRYPTION_KEY);
const dbPath = getDbPath(XMTP_ENV);
console.log("dbPath", dbPath);

console.log("dbEncryptionKey", dbEncryptionKey);

let xmtpClient: Client | null = null;

interface Identity {
  kind: string;
  identifier: string;
  relyingPartner: string;
}

interface RecoveryIdentifier {
  identifier: string;
  identifierKind: number;
}

interface InboxState {
  inboxId: string;
  recoveryIdentifier: RecoveryIdentifier;
  installations: any[];
  identifiers: any[];
}

async function handleCommand(
  command: string,
  conversation: Conversation,
  senderAddress?: string
) {
  const [baseCommand, subCommand] = command.split(" ");

  switch (baseCommand.toLowerCase()) {
    case "/squabble":
      if (!subCommand) {
        // List all available commands
        await conversation.send(`🎮 Available Squabble Commands:
          • /squabble help - Show game rules and instructions
          • /squabble start - Start a new game
          • /squabble leaderboard - View current standings
          • /squabble latest - View the latest game details`);
        return;
      }

      switch (subCommand.toLowerCase()) {
        case "help":
          const rulesPrompt =
            "Generate a concise and engaging explanation of the Squabble game rules. Include that players take turns making moves and the goal is to capture the most territory. Also mention that players can use /squabble start to begin a new game and /squabble leaderboard to see current standings.";
          const rulesResponse = await generateResponse(rulesPrompt);
          await conversation.send(rulesResponse);
          break;

        case "start":
          const usernames = await conversation.members();
          console.log("usernames", JSON.stringify(usernames, null, 2));
          try {
            const response = await fetch(`${SQUABBLE_URL}/api/create-game`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                usernames: usernames,
                betAmount: "0.1", // Placeholder bet amount
                creator: senderAddress || "unknown", // Use the sender's address if available
              }),
            });

            if (!response.ok) {
              throw new Error(`HTTP error! status: ${response.status}`);
            }

            const startPrompt =
              "Generate an exciting message to start a new game of Squabble. Make it engaging and fun.";
            const startResponse = await generateResponse(startPrompt);
            await conversation.send(startResponse);
          } catch (error) {
            console.error("Error creating game:", error);
            await conversation.send(
              "❌ Failed to create game. Please try again."
            );
          }
          break;

        case "leaderboard":
          const leaderboardPrompt =
            "Generate a dynamic leaderboard message for Squabble. Include some example players with points to show the format.";
          const leaderboardResponse = await generateResponse(leaderboardPrompt);
          await conversation.send(leaderboardResponse);
          break;

        case "latest":
          const latestPrompt =
            "Generate a summary of the latest Squabble game. Include who played, the final score, and any notable moments. Make it exciting and engaging.";
          const latestResponse = await generateResponse(latestPrompt);
          await conversation.send(latestResponse);
          break;

        default:
          await conversation.send(
            "❌ Unknown command. Use /squabble to see all available commands."
          );
          break;
      }
      break;

    default:
      // Ignore other commands
      break;
  }
}

// Initialize Express app
const app = express();
app.use(express.json());

// Endpoint to trigger bot message
app.post("/api/send-message", async (req: Request, res: Response) => {
  try {
    const { conversationId, message } = req.body;

    console.log("conversationId", conversationId);
    console.log("message", message);

    if (!conversationId || !message) {
      return res
        .status(400)
        .json({ error: "ConversationId and message are required" });
    }

    if (!xmtpClient) {
      return res.status(500).json({ error: "XMTP client not initialized" });
    }

    // Get or create conversation
    const conversation = await xmtpClient.conversations.getConversationById(
      conversationId
    );
    console.log("conversation", conversation);
    if (!conversation) {
      return res.status(404).json({ error: "Conversation not found" });
    }

    await conversation.send(message);

    res.json({ success: true, message: "Message sent successfully" });
  } catch (error) {
    console.error("Error sending message:", error);
    res.status(500).json({ error: "Failed to send message" });
  }
});

async function main() {
  xmtpClient = await Client.create(signer, {
    dbEncryptionKey,
    env: "dev" as XmtpEnv,
    dbPath,
  });
  console.log("XMTP Client initialized with inbox ID:", xmtpClient.inboxId);

  //void logAgentDetails(xmtpClient);

  await xmtpClient.conversations.sync();

  const stream = await xmtpClient.conversations.streamAllMessages();

  for await (const message of stream) {
    console.log("message", message);
    if (
      message?.senderInboxId.toLowerCase() ===
        xmtpClient.inboxId.toLowerCase() ||
      message?.contentType?.typeId !== "text"
    ) {
      continue;
    }

    const conversationId = message.conversationId;
    console.log("conversationId", conversationId);
    console.log("message.id", message.id);

    const conversation = await xmtpClient.conversations.getConversationById(
      conversationId
    );
    console.log("conversation", JSON.stringify(conversation, null, 2));

    if (!conversation) {
      console.log("Unable to find conversation, skipping");
      continue;
    }

    // Check if the message is a command
    const decodedMessage = message as DecodedMessage;
    const messageText = (decodedMessage.content as Uint8Array).toString();
    const senderInboxId = message.senderInboxId;
    const senderState = (await xmtpClient.preferences.inboxStateFromInboxIds([
      senderInboxId,
    ])) as unknown as InboxState[];
    const senderAddress = senderState[0]?.recoveryIdentifier?.identifier;
    console.log("senderAddress", senderAddress);

    console.log("members", await conversation.members());

    if (messageText.startsWith("/")) {
      await handleCommand(messageText, conversation, senderAddress);
    }

    console.log("Waiting for messages...");
  }
}

// Start Express server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

main().catch(console.error);
