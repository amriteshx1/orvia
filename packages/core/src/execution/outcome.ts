export type RejectionFact = {
  toolName: string;
  reason: string;
};

export function denialReason(comment: string | null | undefined): string {
  const reason = comment?.trim() || "Rejected.";
  return `This action was not performed because the user rejected it. Reason: ${reason} Tell the user the action was not performed and include this reason. Do not claim the action was completed, sent, created, posted, or recorded.`;
}

export function authoritativeFinalText(modelText: string, rejections: RejectionFact[]): string {
  const text = modelText.trim();
  if (rejections.length === 0) return text;
  const facts = rejections
    .map((item) => {
      const reason = item.reason.trim() || "Rejected.";
      return `${item.toolName} was not performed. Reason: ${reason}`;
    })
    .join("\n");
  if (!text || claimsPerformed(text)) return facts;
  const statesDenial = /not performed|was rejected|rejected the|did not (perform|send|create|record|complete|post)|didn't (perform|send|create|record|complete|post)|was not (sent|created|recorded|posted|completed)/i.test(text);
  const includesReasons = rejections.every((item) => {
    const reason = item.reason.trim();
    return reason.length === 0 || text.includes(reason);
  });
  if (statesDenial && includesReasons) return text;
  return `${facts}\n\n${text}`;
}

function claimsPerformed(text: string): boolean {
  if (/not performed|was not|wasn't|did not|didn't|unable to|could not|couldn't|cannot|rejected|was denied|have not|haven't|will not|won't/i.test(text)) {
    return false;
  }
  return /\b(performed|completed|recorded|created|sent|posted|submitted|succeeded|successfully|done|i have|i've|i did)\b/i.test(text);
}
