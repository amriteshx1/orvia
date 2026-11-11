import { MODEL_TOOL_OUTPUT_CHARS } from "./execution/constants";

export function truncateToolResult(value: unknown, maxChars = MODEL_TOOL_OUTPUT_CHARS): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n…[truncated]`;
}
