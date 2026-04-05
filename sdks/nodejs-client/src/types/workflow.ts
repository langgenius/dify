import type {
  DifyRequestFile,
  JsonObject,
  ResponseMode,
  StreamEvent,
} from "./common";

export type WorkflowRunRequest = {
  inputs?: JsonObject;
  user: string;
  response_mode?: ResponseMode;
  files?: DifyRequestFile[] | null;
};

export type WorkflowRunResponse = JsonObject;

export type WorkflowStreamEvent = StreamEvent<JsonObject>;
