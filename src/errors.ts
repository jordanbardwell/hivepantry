import { ZodError } from "zod";

export type ErrorCode = "unauthorized" | "forbidden" | "not_found" | "invalid" | "conflict" | "rate_limited" | "misconfigured" | "internal";

const STATUS: Record<ErrorCode, number> = {
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  invalid: 400,
  conflict: 409,
  rate_limited: 429,
  misconfigured: 500,
  internal: 500,
};

export class PantryError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly issues: string[] = [],
  ) {
    super(message);
  }

  get status(): number {
    return STATUS[this.code];
  }
}

export function toPantryError(err: unknown): PantryError {
  if (err instanceof PantryError) return err;
  if (err instanceof ZodError) {
    return new PantryError(
      "invalid",
      "Invalid input",
      err.issues.map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`),
    );
  }
  console.error(JSON.stringify({ event: "unhandled_error", name: err instanceof Error ? err.name : "error", message: err instanceof Error ? err.message : String(err) }));
  return new PantryError("internal", "Request failed");
}

export function errorBody(err: PantryError): { code: ErrorCode; message: string; issues?: string[] } {
  return err.issues.length ? { code: err.code, message: err.message, issues: err.issues } : { code: err.code, message: err.message };
}
