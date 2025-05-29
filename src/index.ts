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
import express from "express";
import { generateResponse } from "./openAi/client";
import fetch from "node-fetch";
import { setupRoutes } from "./api/routes";
import { fetchUsersByAddresses } from "./lib/neynar.ts";

/* Get the wallet key associated to the public key of
 * the agent and the encryption key for the local db
 * that stores your agent's messages */
const {
  WALLET_KEY,
  ENCRYPTION_KEY,
  XMTP_ENV,
  SQUABBLE_URL,
  NEYNAR_API_KEY,
  AGENT_INBOX_ID,
  AGENT_SECRET,
} = validateEnvironment([
  "WALLET_KEY",
  "ENCRYPTION_KEY",
  "XMTP_ENV",
  "SQUABBLE_URL",
  "NEYNAR_API_KEY",
  "AGENT_INBOX_ID",
  "AGENT_SECRET",
]);

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

interface LeaderboardPlayer {
  fid: number;
  displayName: string;
  username: string;
  avatarUrl: string;
  points: number;
  wins: number;
  totalGames: number;
}

interface LeaderboardResponse {
  leaderboard: LeaderboardPlayer[];
  totalFinishedGames: number;
}

async function handleCommand(
  command: string,
  conversation: Conversation,
  senderAddress?: string,
  senderFid?: string,
  xmtpClient?: Client
) {
  const parts = command.split(" ");
  const baseCommand = parts[0];
  const subCommand = parts.slice(1).join(" ");

  switch (baseCommand.toLowerCase()) {
    case "/squabble":
      if (!subCommand) {
        // List all available commands
        await conversation.send(`🎮 Available Squabble Commands:
          • /squabble help - Show game rules and instructions
          • /squabble start [betAmount] - Start a new game (optional bet amount)
          • /squabble leaderboard - View current standings
          • /squabble latest - View the latest game details`);
        return;
      }

      const parts = subCommand.split(" ");
      const subCommandName = parts[0];
      const betAmount = parts[1];

      switch (subCommandName.toLowerCase()) {
        case "help":
          const rulesPrompt =
            "Generate a concise and engaging explanation of the Squabble game rules. Include that players take turns making moves and the goal is to capture the most territory. Also mention that players can use /squabble start to begin a new game and /squabble leaderboard to see current standings.";
          const rulesResponse = await generateResponse(rulesPrompt);
          await conversation.send(rulesResponse);
          break;

        case "start":
          const members = await conversation.members();
          const inboxIds = members
            .map((member) => member.inboxId)
            .filter((id) => id !== AGENT_INBOX_ID);
          console.log("Inbox IDs (excluding agent):", inboxIds);

          // Get addresses for all members
          const memberStates =
            await xmtpClient?.preferences.inboxStateFromInboxIds(inboxIds);
          const memberAddresses = memberStates
            ?.map((state) => state?.recoveryIdentifier?.identifier)
            .filter(Boolean);

          const usersFIDs = await fetchUsersByAddresses(memberAddresses!);
          console.log("usersFIDs", usersFIDs);

          try {
            const response = await fetch(
              `${SQUABBLE_URL}/api/agent/create-game`,
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  authorization: AGENT_SECRET.trim(),
                },
                body: JSON.stringify({
                  fids: usersFIDs,
                  betAmount: betAmount || "0",
                  creatorAddress: senderAddress || "unknown",
                  creatorFid: senderFid || "unknown",
                  conversationId: conversation?.id,
                }),
              }
            );

            if (!response.ok) {
              throw new Error(`HTTP error! status: ${response.status}`);
            }

            const gameData = await response.json();
            const gameUrl = `${SQUABBLE_URL}/games/${gameData.id}`;
            await conversation.send(
              `🎮 Game created! You can play here: ${gameUrl}\nGood luck! 🍀`
            );
          } catch (error) {
            console.error("Error creating game:", error);
            await conversation.send(
              "❌ Failed to create game. Please try again."
            );
          }
          break;

        case "leaderboard":
          try {
            const response = await fetch(
              `${SQUABBLE_URL}/api/agent/leaderboard?conversationId=${conversation?.id}`,
              {
                method: "GET",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: AGENT_SECRET.trim(),
                },
              }
            );

            if (!response.ok) {
              throw new Error(`HTTP error! status: ${response.status}`);
            }

            const leaderboardData = await response.json();

            // Create a filtered version for processing
            const filteredLeaderboard = (
              leaderboardData as LeaderboardResponse
            ).leaderboard.map((player) => ({
              fid: player.fid,
              displayName: player.displayName,
              username: player.username,
              points: player.points,
              wins: player.wins,
              totalGames: player.totalGames,
            }));

            // Sort by points (highest first), then by wins if tied
            filteredLeaderboard.sort((a, b) => {
              if (b.points !== a.points) return b.points - a.points;
              return b.wins - a.wins;
            });

            // Format the leaderboard table directly
            let leaderboardMessage = "🏆 Squabble Leaderboard 🏆\n\n";

            filteredLeaderboard.forEach((player, index) => {
              const rank = index + 1;
              leaderboardMessage += `${rank}. ${player.username} - ${player.points} pts (${player.wins}W/${player.totalGames}G)\n`;
            });

            leaderboardMessage +=
              "\n🎮 Battle for the top spot! Who will claim victory next?";

            await conversation.send(leaderboardMessage);
          } catch (error) {
            console.error("Error fetching leaderboard:", error);
            await conversation.send(
              "❌ Failed to fetch leaderboard. Please try again."
            );
          }
          break;

        case "latest":
          try {
            const response = await fetch(`${SQUABBLE_URL}/api/agent/get-game`, {
              method: "GET",
              headers: {
                "Content-Type": "application/json",
                authorization: AGENT_SECRET.trim(),
              },
            });

            if (!response.ok) {
              throw new Error(`HTTP error! status: ${response.status}`);
            }

            const gameData = await response.json();
            const gameUrl = `${SQUABBLE_URL}/games/${gameData.id}`;
            await conversation.send(
              `🎮 Latest Game:\nYou can view it here: ${gameUrl}`
            );
          } catch (error) {
            console.error("Error fetching latest game:", error);
            await conversation.send(
              "❌ Failed to fetch latest game. Please try again."
            );
          }
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

async function main() {
  const signer = createSigner(WALLET_KEY);
  const dbEncryptionKey = getEncryptionKeyFromHex(ENCRYPTION_KEY);
  const dbPath = getDbPath(XMTP_ENV);

  xmtpClient = await Client.create(signer, {
    dbEncryptionKey,
    env: "dev" as XmtpEnv,
    dbPath,
  });

  // Initialize Express app
  const app = express();
  app.use(express.json());

  // Setup routes with initialized client
  setupRoutes(app, xmtpClient);

  // Start Express server
  const PORT = process.env.PORT || 3002;
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });

  // Log agent details
  void logAgentDetails(xmtpClient);

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

    const conversation = await xmtpClient.conversations.getConversationById(
      conversationId
    );
    console.log("conversation details:", {
      id: conversation?.id,
      type: conversation?.constructor.name,
      createdAt: conversation?.createdAt,
    });

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
    const senderFid = await fetchUsersByAddresses([senderAddress]);
    console.log("senderAddress", senderAddress);
    console.log("senderFid", senderFid);

    const members = await conversation.members();
    console.log(
      "Members details:",
      members.map((member) => ({
        inboxId: member.inboxId,
        accountIdentifiers: member.accountIdentifiers,
        installationIds: member.installationIds,
        permissionLevel: member.permissionLevel,
        consentState: member.consentState,
      }))
    );

    if (messageText.startsWith("/")) {
      await handleCommand(
        messageText,
        conversation,
        senderAddress,
        senderFid[0],
        xmtpClient
      );
    }

    console.log("Waiting for messages...");
  }
}

main().catch(console.error);
