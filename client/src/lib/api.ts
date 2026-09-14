export class ApiError extends Error {
  readonly status: number;
  readonly details: unknown;

  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }
}

type ApiOptions = Omit<RequestInit, "body"> & { body?: unknown };

let unauthorizedHandler: (() => void) | null = null;

/** O App registra aqui o que fazer quando a sessao cai: voltar para a tela de login. */
export function setUnauthorizedHandler(handler: () => void): void {
  unauthorizedHandler = handler;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function formatApiError(error: unknown): string {
  if (!(error instanceof ApiError)) {
    return error instanceof Error ? error.message : "Erro inesperado.";
  }
  const details = error.details;
  if (isObject(details) && isObject(details.fieldErrors)) {
    const messages = Object.values(details.fieldErrors)
      .flatMap((value) => (Array.isArray(value) ? value : []))
      .filter((value): value is string => typeof value === "string");
    if (messages.length) return messages.join(" ");
  }
  if (isObject(details) && Array.isArray(details.formErrors) && details.formErrors.length) {
    return details.formErrors.join(" ");
  }
  return error.message;
}

export async function apiRequest<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const { body, headers, ...rest } = options;
  const response = await fetch(path, {
    ...rest,
    credentials: "same-origin",
    headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const payload: unknown = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith("/api/auth/")) unauthorizedHandler?.();
    throw new ApiError(
      (isObject(payload) && typeof payload.message === "string" && payload.message) || "Falha na requisição.",
      response.status,
      isObject(payload) ? payload.details : undefined
    );
  }
  return payload as T;
}
