import { encode } from "gpt-tokenizer";

const MAX_EXACT_TOKENIZE_CHARS = 50_000;

export function countTokens(text: string): number {
  if (!text) return 0;
  // Avoid blocking the event loop with BPE tokenization on huge coding contexts
  if (text.length > MAX_EXACT_TOKENIZE_CHARS) {
    return Math.ceil(text.length / 4);
  }
  try {
    return encode(text).length;
  } catch {
    return Math.floor(text.length / 4);
  }
}
