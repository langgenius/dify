import type {
  DifyRequestFile,
  JsonObject,
  ResponseMode,
  StreamEvent,
} from "./common";

export type ChatMessageRequest = {
  inputs?: JsonObject;
  query: string;
  user: string;
  response_mode?: ResponseMode;
  files?: DifyRequestFile[] | null;
  conversation_id?: string;
  auto_generate_name?: boolean;
  workflow_id?: string;
  retriever_from?: "app" | "dataset";
};

export type ChatMessageResponse = JsonObject;

export type ChatStreamEvent = StreamEvent<JsonObject>;

export type ConversationSortBy =
  | "created_at"
  | "-created_at"
  | "updated_at"
  | "-updated_at";
