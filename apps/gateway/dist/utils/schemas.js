import { z } from "zod";
export const chatCompletionSchema = z.object({
  model: z.string().optional().default("gemini-3.5-flash"),
  messages: z
    .array(
      z.object({
        role: z.enum(["system", "user", "assistant", "tool"]),
        content: z
          .union([z.string(), z.array(z.any())])
          .optional()
          .default(""),
        name: z.string().optional(),
        tool_calls: z.array(z.any()).optional()
      })
    )
    .min(1, "messages list must contain at least 1 message"),
  stream: z.boolean().optional().default(false),
  tools: z.array(z.any()).optional(),
  temperature: z.number().optional(),
  max_tokens: z.number().optional(),
  response_format: z
    .object({
      type: z.enum(["text", "json_object"])
    })
    .optional()
});
export const responsesApiSchema = z.object({
  model: z.string().optional().default("gemini-3.5-flash"),
  input: z
    .union([z.string(), z.array(z.any())])
    .optional()
    .default(""),
  instructions: z.string().optional(),
  tools: z.array(z.any()).optional(),
  stream: z.boolean().optional().default(false)
});
