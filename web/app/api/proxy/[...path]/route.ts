import { NextRequest } from "next/server";
import { proxyToAPI } from "@/lib/backend-proxy";

type RouteContext = { params: Promise<{ path: string[] }> };

function proxy(request: NextRequest, context: RouteContext) {
  return proxyToAPI(request, context, "/api");
}

export const dynamic = "force-dynamic";

export {
  proxy as GET,
  proxy as POST,
  proxy as PUT,
  proxy as PATCH,
  proxy as DELETE,
  proxy as HEAD,
  proxy as OPTIONS,
};
