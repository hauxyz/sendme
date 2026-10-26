export const PUBLIC_API_URL =
  process.env.NEXT_PUBLIC_API_PUBLIC_URL?.replace(/\/$/, "") || "http://localhost:3000";

export class ApiError extends Error {
  status: number;
  code: string;

  constructor(message: string, status: number, code = "request_failed") {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

type ApiOptions = Omit<RequestInit, "body"> & {
  body?: unknown;
};

export async function api<T = unknown>(path: string, options: ApiOptions = {}): Promise<T> {
  const { body, headers, ...rest } = options;
  const requestHeaders = new Headers(headers);
  let payload: BodyInit | undefined;

  if (body !== undefined) {
    if (typeof body === "string" || body instanceof FormData || body instanceof Blob) {
      payload = body;
    } else {
      requestHeaders.set("Content-Type", "application/json");
      payload = JSON.stringify(body);
    }
  }

  const response = await fetch(`/api/proxy${path}`, {
    ...rest,
    body: payload,
    headers: requestHeaders,
    credentials: "include",
    cache: "no-store",
  });

  const isJSON = response.headers.get("content-type")?.includes("application/json");
  const data = isJSON ? await response.json().catch(() => null) : null;

  if (!response.ok) {
    const message =
      data?.error?.message ||
      (typeof data?.message === "string" ? data.message : null) ||
      `Request failed with status ${response.status}`;
    const code = data?.error?.code || "request_failed";
    if (response.status === 401 && typeof window !== "undefined") {
      window.dispatchEvent(new Event("sendme:unauthorized"));
    }
    throw new ApiError(message, response.status, code);
  }
  return data as T;
}

export const fetcher = <T>(path: string) => api<T>(path);
