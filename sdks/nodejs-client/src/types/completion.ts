import type { StreamEvent } from "./common";

export type CompletionRequest = {
  inputs?: Record<string, unknown>;
  response_mode?: "blocking" | "streaming";
  user: string;
  files?: unknown;
  retriever_from?: "app" | "dataset";
};

export type CompletionResponse = Record<string, unknown>;

export type CompletionStreamEvent = StreamEvent<Record<string, unknown>>;
