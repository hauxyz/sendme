import { NextRequest } from "next/server";
import { proxyToAPI } from "@/lib/backend-proxy";

type RouteContext = { params: Promise<{ path: string[] }> };

function proxy(request: NextRequest, context: RouteContext) {
  return proxyToAPI(request, context, "/api/u");
}

export const dynamic = "force-dynamic";

export { proxy as GET, proxy as HEAD };
