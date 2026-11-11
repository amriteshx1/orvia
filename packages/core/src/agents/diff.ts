import { diffLines } from "diff";
import type { AgentSnapshot } from "./defaults";

export type InstructionChange = {
  type: "same" | "add" | "remove";
  text: string;
};

export type FieldChange = {
  field: string;
  before: string;
  after: string;
};

export function diffInstructions(before: string, after: string): InstructionChange[] {
  const changes: InstructionChange[] = [];
  for (const part of diffLines(before, after)) {
    const type = part.added ? "add" : part.removed ? "remove" : "same";
    const lines = part.value.split("\n");
    if (lines.at(-1) === "") lines.pop();
    for (const line of lines) changes.push({ type, text: line });
  }
  return changes;
}

export function diffSettings(before: AgentSnapshot, after: AgentSnapshot): FieldChange[] {
  const changes: FieldChange[] = [];
  const left = flatten(before);
  const right = flatten(after);
  delete left.instructions;
  delete right.instructions;
  const fields = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
  for (const field of fields) {
    const previous = left[field] ?? "";
    const next = right[field] ?? "";
    if (previous !== next) changes.push({ field, before: previous, after: next });
  }
  return changes;
}

function flatten(snapshot: AgentSnapshot): Record<string, string> {
  const { approvalPolicy, enabledTools, ...rest } = snapshot;
  const flat: Record<string, string> = {};
  for (const [key, value] of Object.entries(rest)) {
    if (key === "instructions" || key === "id" || key === "versionNumber" || key === "createdAt") {
      if (key === "instructions") flat.instructions = String(value);
      continue;
    }
    flat[key] = String(value);
  }
  flat.enabledTools = [...enabledTools].sort().join(", ");
  flat["approvalPolicy.unknown"] = approvalPolicy.unknown;
  for (const [action, mode] of Object.entries(approvalPolicy.tools).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    flat[`approvalPolicy.tools.${action}`] = mode;
  }
  return flat;
}
