import { NotFoundError, ValidationError } from "@orvia/core/agents";
import { LimitError } from "@orvia/core/execution";

export function agentErrorResponse(error: unknown): Response {
  if (error instanceof NotFoundError) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  if (error instanceof ValidationError) {
    return Response.json({ error: error.message, issues: error.issues }, { status: 400 });
  }
  if (error instanceof LimitError) {
    return Response.json({ error: error.message }, { status: 409 });
  }
  console.error(error);
  return Response.json({ error: "Something went wrong" }, { status: 500 });
}
