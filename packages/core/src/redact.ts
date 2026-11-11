import { STORED_OUTPUT_CHARS } from "./execution/constants";

const SECRET_KEY = /authorization|api[_-]?key|token|secret|password|cookie|credential/i;

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[truncated]";
  if (typeof value === "string") {
    return value.length > STORED_OUTPUT_CHARS
      ? `${value.slice(0, STORED_OUTPUT_CHARS)}…`
      : value;
  }
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  if (value === undefined) return null;
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  if (typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      output[key] = SECRET_KEY.test(key) ? "[redacted]" : redact(child, depth + 1);
    }
    return output;
  }
  return String(value);
}
