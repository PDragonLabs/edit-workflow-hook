import { createServerFn } from "@tanstack/react-start";

export const aiStatus = createServerFn({ method: "GET" }).handler(async () => {
  return { ok: Boolean(process.env.XAI_API_KEY) };
});

type AskInput = {
  prompt: string;
  captions: { id: string; text: string }[];
};

export const askShed = createServerFn({ method: "POST" })
  .validator((input: AskInput) => input)
  .handler(async ({ data }) => {
    const apiKey = process.env.XAI_API_KEY;
    if (!apiKey) return { ok: false as const, error: "AI is not available" };

    const prompt = data.prompt.slice(0, 800);
    const res = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "grok-4.5",
        max_tokens: 400,
        messages: [
          {
            role: "system",
            content:
              "You are Shed, PDragonLabs' edit assistant. Alchemy × tech. Short answers. If rewriting captions, return JSON only: {\"captions\":[{\"id\":\"...\",\"text\":\"...\"}]} with the same ids, uppercase, punchy, max 8 words each.",
          },
          {
            role: "user",
            content: `Captions:\n${JSON.stringify(data.captions)}\n\n${prompt}`,
          },
        ],
      }),
    });
    if (!res.ok) return { ok: false as const, error: `xAI ${res.status}` };
    const body = (await res.json()) as {
      choices: { message: { content: string } }[];
    };
    return { ok: true as const, text: body.choices[0]?.message.content ?? "" };
  });
