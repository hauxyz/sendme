import { NextRequest } from "next/server";

const API_BASE = (process.env.API_INTERNAL_URL || "http://localhost:8080").replace(/\/$/, "");

const hopHeaders = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length",
  "accept-encoding",
]);

async function proxy(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  const target = `${API_BASE}/api/${path.map(encodeURIComponent).join("/")}${request.nextUrl.search}`;

  const headers = new Headers();
  request.headers.forEach((value, key) => {
    if (!hopHeaders.has(key.toLowerCase())) {
      headers.set(key, value);
    }
  });
  if (!headers.has("x-forwarded-for")) {
    const forwarded = request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip");
    if (forwarded) headers.set("x-forwarded-for", forwarded);
  }

  try {
    const response = await fetch(target, {
      method: request.method,
      headers,
      body: ["GET", "HEAD"].includes(request.method) ? undefined : await request.arrayBuffer(),
      redirect: "manual",
      cache: "no-store",
    });

    const responseHeaders = new Headers();
    response.headers.forEach((value, key) => {
      const lower = key.toLowerCase();
      if (!hopHeaders.has(lower) && lower !== "set-cookie") {
        responseHeaders.append(key, value);
      }
    });

    const cookies =
      typeof response.headers.getSetCookie === "function"
        ? response.headers.getSetCookie()
        : [];
    if (cookies.length > 0) {
      for (const cookie of cookies) {
        responseHeaders.append("set-cookie", cookie);
      }
    } else {
      const single = response.headers.get("set-cookie");
      if (single) responseHeaders.append("set-cookie", single);
    }

    return new Response(await response.arrayBuffer(), {
      status: response.status,
      headers: responseHeaders,
    });
  } catch {
    return Response.json(
      { error: { code: "api_unreachable", message: "The SendMe API is unreachable." } },
      { status: 502 },
    );
  }
}

export const dynamic = "force-dynamic";

export {
  proxy as GET,
  proxy as POST,
  proxy as PUT,
  proxy as PATCH,
  proxy as DELETE,
  proxy as OPTIONS,
};
