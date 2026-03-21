import type { StreamEvent } from "./common";

export type ChatMessageRequest = {
  inputs?: Record<string, unknown>;
  query: string;
  user: string;
  response_mode?: "blocking" | "streaming";
  files?: Array<Record<string, unknown>> | null;
  conversation_id?: string;
  auto_generate_name?: boolean;
  workflow_id?: string;
  retriever_from?: "app" | "dataset";
};

export type ChatMessageResponse = Record<string, unknown>;

export type ChatStreamEvent = StreamEvent<Record<string, unknown>>;
