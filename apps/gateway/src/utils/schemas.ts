import { z } from "zod";

export const chatCompletionSchema = z.object({
  model: z
    .string()
    .nullish()
    .transform((v) => v || "gemini-4-hydrogen"),
  messages: z
    .array(
      z.object({
        role: z.enum(["system", "user", "assistant", "tool", "developer", "function"]),
        content: z
          .union([z.string(), z.array(z.any())])
          .nullish()
          .transform((v) => v ?? ""),
        name: z.string().nullish(),
        tool_calls: z.array(z.any()).nullish(),
        tool_call_id: z.string().nullish()
      })
    )
    .min(1, "messages list must contain at least 1 message"),
  stream: z
    .boolean()
    .nullish()
    .transform((v) => v ?? false),
  stream_options: z
    .object({
      include_usage: z.boolean().nullish()
    })
    .nullish(),
  stop: z.union([z.string(), z.array(z.string())]).nullish(),
  tools: z.array(z.any()).nullish(),
  tool_choice: z.union([z.string(), z.record(z.string(), z.any())]).nullish(),
  parallel_tool_calls: z.boolean().nullish(),
  temperature: z.number().nullish(),
  max_tokens: z.number().nullish(),
  max_completion_tokens: z.number().nullish(),
  reasoning_effort: z.string().nullish(),
  response_format: z
    .object({
      type: z.enum(["text", "json_object", "json_schema"]),
      json_schema: z.any().nullish()
    })
    .nullish()
});

export const responsesApiSchema = z.object({
  model: z
    .string()
    .nullish()
    .transform((v) => v || "gemini-4-hydrogen"),
  input: z
    .union([z.string(), z.array(z.any())])
    .nullish()
    .transform((v) => v ?? ""),
  instructions: z.string().nullish(),
  tools: z.array(z.any()).nullish(),
  tool_choice: z.union([z.string(), z.record(z.string(), z.any())]).nullish(),
  reasoning: z.record(z.string(), z.any()).nullish(),
  text: z
    .object({
      format: z
        .object({
          type: z.enum(["text", "json_object", "json_schema"]),
          schema: z.any().nullish(),
          name: z.string().nullish()
        })
        .nullish()
    })
    .nullish(),
  stream: z
    .boolean()
    .nullish()
    .transform((v) => v ?? false)
});
