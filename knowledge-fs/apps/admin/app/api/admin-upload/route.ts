import { createUploadDocumentRedirectHandler } from "../../../lib/upload-action";

const handler = createUploadDocumentRedirectHandler();

export async function POST(request: Request): Promise<Response> {
  return handler.handle(request);
}
