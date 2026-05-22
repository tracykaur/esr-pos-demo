// Thin typed wrapper around the admin GraphQL client returned by
// authenticate.public.pos / authenticate.admin. Centralizes error handling so
// every route returns the standard { error, code } envelope on upstream
// failure instead of leaking @shopify/shopify-app-remix internals.

import { errorJson } from "./json.server";

type AdminClient = {
  graphql: (query: string, opts?: { variables?: Record<string, unknown> }) => Promise<Response>;
};

type GraphqlSuccess<T> = { data: T };
type GraphqlError = { errors: Array<{ message: string; path?: string[] }> };
type GraphqlResult<T> = GraphqlSuccess<T> | GraphqlError;

export async function gql<T>(
  admin: unknown,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const client = admin as AdminClient;
  const response = await client.graphql(query, { variables });
  const payload = (await response.json()) as GraphqlResult<T>;
  if ("errors" in payload && payload.errors && payload.errors.length > 0) {
    const messages = payload.errors.map((e) => e.message).join("; ");
    throw new GraphqlOperationError(messages, payload.errors);
  }
  return (payload as GraphqlSuccess<T>).data;
}

export class GraphqlOperationError extends Error {
  constructor(
    message: string,
    public readonly errors: GraphqlError["errors"],
  ) {
    super(message);
    this.name = "GraphqlOperationError";
  }
}

// Wraps a route handler so any thrown GraphqlOperationError becomes a 502
// JSON envelope instead of a 500 with a stack trace.
export async function runRouteOp<T>(
  op: () => Promise<T>,
): Promise<T | ReturnType<typeof errorJson>> {
  try {
    return await op();
  } catch (err) {
    if (err instanceof GraphqlOperationError) {
      return errorJson("UPSTREAM_ERROR", err.message, {
        details: err.errors,
      });
    }
    if (err instanceof Response) {
      // Re-throw responses (e.g. the 401 from authenticatePos).
      throw err;
    }
    const message = err instanceof Error ? err.message : "Internal error";
    return errorJson("INTERNAL", message);
  }
}

// Extract the userErrors array from a mutation payload, return null if empty.
export function userErrorsOf<E extends { field?: unknown; message: string }>(
  errors: ReadonlyArray<E> | undefined,
): ReadonlyArray<E> | null {
  if (!errors || errors.length === 0) return null;
  return errors;
}
