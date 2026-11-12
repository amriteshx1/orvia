export type EvalAssertion =
  | { type: "contains"; value: string }
  | { type: "expected_tools"; tools: string[] }
  | { type: "max_cost_usd"; value: number }
  | { type: "max_latency_ms"; value: number }
  | { type: "llm_rubric"; value: string };

export function parseAssertions(value: unknown): EvalAssertion[] {
  if (!Array.isArray(value)) return [];
  const assertions: EvalAssertion[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    if (record.type === "contains" && typeof record.value === "string" && record.value.trim()) {
      assertions.push({ type: "contains", value: record.value.trim() });
    } else if (record.type === "expected_tools" && Array.isArray(record.tools)) {
      const tools = record.tools.filter((tool): tool is string => typeof tool === "string" && tool.trim().length > 0);
      if (tools.length > 0) assertions.push({ type: "expected_tools", tools });
    } else if (record.type === "max_cost_usd" && typeof record.value === "number" && record.value >= 0) {
      assertions.push({ type: "max_cost_usd", value: record.value });
    } else if (record.type === "max_latency_ms" && typeof record.value === "number" && record.value >= 0) {
      assertions.push({ type: "max_latency_ms", value: record.value });
    } else if (record.type === "llm_rubric" && typeof record.value === "string" && record.value.trim()) {
      assertions.push({ type: "llm_rubric", value: record.value.trim() });
    }
  }
  return assertions;
}
