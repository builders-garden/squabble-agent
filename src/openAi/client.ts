import OpenAI from "openai";
import { validateEnvironment } from "../helpers/client";

const { OPENAI_API_KEY } = validateEnvironment(["OPENAI_API_KEY"]);

const openai = new OpenAI({
    apiKey: OPENAI_API_KEY,
});

export async function generateResponse(prompt: string): Promise<string> {
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