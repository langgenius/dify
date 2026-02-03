import type { StreamEvent } from "./common";

export type WorkflowRunRequest = {
  inputs?: Record<string, unknown>;
  user: string;
  response_mode?: "blocking" | "streaming";
  files?: Array<Record<string, unknown>> | null;
};

export type WorkflowRunResponse = Record<string, unknown>;

export type WorkflowStreamEvent = StreamEvent<Record<string, unknown>>;
