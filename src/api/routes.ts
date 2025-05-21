import express, { Request, Response } from "express";
import { Client } from "@xmtp/node-sdk";

export function setupRoutes(
  app: express.Application,
  xmtpClient: Client | null
) {
  // Endpoint to trigger bot message
  app.post("/api/send-message", async (req: Request, res: Response) => {
    try {
      const { conversationId, message } = req.body;

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
      console.log("conversation details:", {
        id: conversation?.id,
        type: conversation?.constructor.name,
        createdAt: conversation?.createdAt,
      });
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
}
