import type { AnswerTraceSource } from "@knowledge/core";
import type { DifyCapabilityV2SanitizedGrant } from "./dify-capability-v2-grant";
import type { KnowledgeSpaceCallerKind } from "./knowledge-space-authorization";

/**
 * Derive the AnswerTrace source from the authenticated caller.
 *
 * Capability v2 grants carry the precise caller kind (the gateway collapses `workflow` into
 * `agent` for access-channel purposes, which is too coarse for history); legacy sessions and
 * API keys only expose the gateway caller kind. Anything unknown is a console retrieval test.
 */
export function answerTraceSourceForCaller({
  callerKind,
  capabilityCallerKind,
}: {
  readonly callerKind?: KnowledgeSpaceCallerKind | undefined;
  readonly capabilityCallerKind?: DifyCapabilityV2SanitizedGrant["callerKind"] | undefined;
}): AnswerTraceSource {
  switch (capabilityCallerKind) {
    case "workflow":
      return "workflow";
    case "agent":
      return "agent";
    case "mcp":
      return "mcp";
    case "service":
    case "internal_worker":
      return "service_api";
    case "interactive":
      return "retrieval_test";
    default:
      break;
  }
  switch (callerKind) {
    case "agent":
      return "agent";
    case "mcp":
      return "mcp";
    case "api_key":
    case "service_api":
      return "service_api";
    default:
      return "retrieval_test";
  }
}
