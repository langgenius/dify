/** Handler-safe Capability v2 provenance. It cannot represent a bearer token or raw jti. */
export interface DifyCapabilityV2SanitizedGrant {
  readonly action: string;
  readonly actor: string;
  readonly authzRevision: {
    readonly credential_revision: number | null;
    readonly external_access_epoch: number;
    readonly membership_epoch: number;
    readonly space_acl_epoch: number;
  };
  readonly azp: string;
  readonly callerKind: "agent" | "interactive" | "internal_worker" | "mcp" | "service" | "workflow";
  readonly capVersion: 2;
  readonly contentPolicyRevision: number;
  readonly contentScopeIds: readonly string[];
  readonly controlSpaceId: string;
  readonly expiresAt: number;
  readonly grantId: string;
  readonly issuedAt: number;
  readonly jtiHash: string;
  readonly namespaceId: string;
  readonly notBefore: number;
  readonly resource: {
    readonly id: string;
    readonly parent_id: string | null;
    readonly type:
      | "document"
      | "job"
      | "knowledge_space"
      | "namespace"
      | "query"
      | "research_task"
      | "source"
      | "upload_session";
  };
  readonly subject: string;
  readonly traceId: string;
}
