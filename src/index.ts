import {
  createSigner,
  getEncryptionKeyFromHex,
  logAgentDetails,
  validateEnvironment,
} from "./helpers/client.ts";
import { Client, type XmtpEnv, type DecodedMessage } from "@xmtp/node-sdk";
import OpenAI from "openai";

/* Get the wallet key associated to the public key of
 * the agent and the encryption key for the local db
 * that stores your agent's messages */
const { WALLET_KEY, ENCRYPTION_KEY, XMTP_ENV, OPENAI_API_KEY } =
  validateEnvironment([
    "WALLET_KEY",
    "ENCRYPTION_KEY",
    "XMTP_ENV",
    "OPENAI_API_KEY",
  ]);

/* Create the signer using viem and parse the encryption key for the local db */
const signer = createSigner(WALLET_KEY);
const dbEncryptionKey = getEncryptionKeyFromHex(ENCRYPTION_KEY);

const openai = new OpenAI({
  apiKey: OPENAI_API_KEY,
});

async function generateResponse(prompt: string): Promise<string> {
  const completion = await openai.chat.completions.create({
    messages: [
      {
        role: "system",
        content:
          "You are a helpful game assistant for Squabble. Keep responses concise and engaging.",
      },
      { role: "user", content: prompt },
    ],
    model: "gpt-3.5-turbo",
  });

  return (
    completion.choices[0]?.message?.content ||
    "Sorry, I couldn't generate a response."
  );
}

async function handleCommand(command: string, conversation: any) {
  switch (command.toLowerCase()) {
    case "@squabble":
      const rulesPrompt =
        "Generate a concise and engaging explanation of the Squabble game rules. Include that players take turns making moves and the goal is to capture the most territory. Also mention that players can use @start-game to begin a new game and @leaderboard to see current standings.";
      const rulesResponse = await generateResponse(rulesPrompt);
      await conversation.send(rulesResponse);
      break;
    case "@start-game":
      const startPrompt =
        "Generate an exciting message to start a new game of Squabble. Make it engaging and fun.";
      const startResponse = await generateResponse(startPrompt);
      await conversation.send(startResponse);
      break;
    case "@leaderboard":
      const leaderboardPrompt =
        "Generate a dynamic leaderboard message for Squabble. Include some example players with points to show the format.";
      const leaderboardResponse = await generateResponse(leaderboardPrompt);
      await conversation.send(leaderboardResponse);
      break;
    default:
      break;
  }
}

async function main() {
  const client = await Client.create(signer, {
    dbEncryptionKey,
    env: "dev" as XmtpEnv,
  });
  void logAgentDetails(client);

  await client.conversations.sync();

  const stream = await client.conversations.streamAllMessages();

  for await (const message of stream) {
    if (
      message?.senderInboxId.toLowerCase() === client.inboxId.toLowerCase() ||
      message?.contentType?.typeId !== "text"
    ) {
      continue;
    }

    const conversation = await client.conversations.getConversationById(
      message.conversationId
    );

    if (!conversation) {
      console.log("Unable to find conversation, skipping");
      continue;
    }

    // Check if the message is a command
    const decodedMessage = message as DecodedMessage;
    const messageText = (decodedMessage.content as Uint8Array).toString();
    if (messageText.startsWith("@")) {
      await handleCommand(messageText, conversation);
    }

    console.log("Waiting for messages...");
  }
}

main().catch(console.error);
