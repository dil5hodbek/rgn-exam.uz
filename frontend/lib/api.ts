const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "/api/v1";
export const API_ORIGIN = API_URL.replace(/\/api\/v1\/?$/, "");

export class ApiError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "ApiError";
  }
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

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const isFormData = typeof FormData !== "undefined" && init?.body instanceof FormData;
  const requestInit: RequestInit = {
    ...init,
    credentials: "include",
    headers: isFormData ? init?.headers : { "Content-Type": "application/json", ...init?.headers },
  };
  let response = await fetch(`${API_URL}${path}`, requestInit);

  const isAuthenticationRequest = [
    "/auth/login",
    "/auth/register",
    "/auth/refresh",
    "/auth/telegram",
    "/auth/forgot",
  ].some((authPath) => path.startsWith(authPath));

  if (response.status === 401 && !isAuthenticationRequest) {
    if (await refreshSession()) {
      response = await fetch(`${API_URL}${path}`, requestInit);
    }
  }

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new ApiError(data.detail ?? "Something went wrong. Please try again.", response.status);
  }
  if (response.status === 204) return undefined as T;
  return response.json();
}

export function mediaUrl(path?: string | null) {
  if (!path) return "";
  return path.startsWith("http") ? path : `${API_ORIGIN}${path}`;
}
