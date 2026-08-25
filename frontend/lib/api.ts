const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "/api/v1";
export const API_ORIGIN = API_URL.replace(/\/api\/v1\/?$/, "");

export class ApiError extends Error {
  constructor(message: string, public readonly status: number, public readonly detail?: unknown) {
    super(message);
    this.name = "ApiError";
  }
}

// FastAPI's `detail` may be a plain string OR a structured object like
// {message, errors: [...]} — always derive a readable message, never
// "[object Object]".
function detailMessage(detail: unknown): string {
  if (typeof detail === "string" && detail.trim()) return detail;
  if (detail && typeof detail === "object") {
    const message = (detail as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return "Something went wrong. Please try again.";
}

let refreshPromise: Promise<boolean> | null = null;

async function refreshSession(): Promise<boolean> {
  if (!refreshPromise) {
    refreshPromise = fetch(`${API_URL}/auth/refresh`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
    })
      .then((response) => response.ok)
      .catch(() => false)
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

// The tunnel in front of this app briefly recycles its connection every so
// often; any request in flight at that exact moment fails at the network
// level (fetch throws, not an HTTP error) with "Failed to fetch". That's a
// transient last-mile blip, not a real failure, so retry a couple of times
// with a short backoff before giving up — but never for a request that might
// not be safe to repeat blindly.
const RETRYABLE_METHODS = new Set(["GET", "HEAD", "PATCH"]);

async function fetchWithRetry(url: string, requestInit: RequestInit): Promise<Response> {
  const method = (requestInit.method ?? "GET").toUpperCase();
  const attempts = RETRYABLE_METHODS.has(method) ? 3 : 1;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fetch(url, requestInit);
    } catch (reason) {
      if (attempt === attempts) throw reason;
      await new Promise((resolve) => setTimeout(resolve, attempt * 400));
    }
  }
  throw new Error("unreachable");
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const isFormData = typeof FormData !== "undefined" && init?.body instanceof FormData;
  const requestInit: RequestInit = {
    ...init,
    credentials: "include",
    headers: isFormData ? init?.headers : { "Content-Type": "application/json", ...init?.headers },
  };
  let response = await fetchWithRetry(`${API_URL}${path}`, requestInit);

  const isAuthenticationRequest = [
    "/auth/login",
    "/auth/register",
    "/auth/refresh",
    "/auth/telegram",
    "/auth/forgot",
  ].some((authPath) => path.startsWith(authPath));

  if (response.status === 401 && !isAuthenticationRequest) {
    if (await refreshSession()) {
      response = await fetchWithRetry(`${API_URL}${path}`, requestInit);
    }
  }

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new ApiError(detailMessage(data.detail), response.status, data.detail);
  }
  if (response.status === 204) return undefined as T;
  return response.json();
}

export function mediaUrl(path?: string | null) {
  if (!path) return "";
  return path.startsWith("http") ? path : `${API_ORIGIN}${path}`;
}
