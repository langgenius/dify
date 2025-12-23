import type { StreamEvent } from "./common.js";

export type WorkflowRunRequest = {
  inputs?: Record<string, unknown>;
  user: string;
  response_mode?: "blocking" | "streaming";
};

export type WorkflowRunResponse = Record<string, unknown>;

export type WorkflowStreamEvent = StreamEvent<Record<string, unknown>>;
