import type {
  DifyRequestFile,
  JsonObject,
  ResponseMode,
  StreamEvent,
} from "./common";

export type CompletionRequest = {
  inputs?: JsonObject;
  response_mode?: ResponseMode;
  user: string;
  files?: DifyRequestFile[] | null;
  retriever_from?: "app" | "dataset";
};

export type CompletionResponse = JsonObject;

export type CompletionStreamEvent = StreamEvent<JsonObject>;
