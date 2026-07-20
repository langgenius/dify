import { createAdminBffProxy } from "../../../../lib/bff";

const proxy = createAdminBffProxy();

interface RouteContext {
  params: Promise<{
    path?: string[];
  }>;
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  return proxy.proxy(request, await context.params);
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  return proxy.proxy(request, await context.params);
}

export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  return proxy.proxy(request, await context.params);
}

export async function DELETE(request: Request, context: RouteContext): Promise<Response> {
  return proxy.proxy(request, await context.params);
}
