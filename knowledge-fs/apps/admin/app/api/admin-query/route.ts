import { createRunQueryRedirectHandler } from "../../../lib/query-action";

const handler = createRunQueryRedirectHandler();

export async function POST(request: Request): Promise<Response> {
  return handler.handle(request);
}
