import type {
  MemberActionResponse,
  MemberInvitePayload,
  MemberInviteResponse,
  MemberListResponse,
  MemberRoleUpdatePayload,
} from '@dify/contracts/api/openapi/types.gen'
import type { OpenApiClient } from '@/http/orpc'
import type { HttpClient } from '@/http/types'
import { createOpenApiClient, unwrap } from '@/http/orpc'

/**
 * Thin client for /openapi/v1/workspaces/<id>/members, over the generated oRPC contract.
 *
 * Errors are surfaced as BaseError via mapOrpcError on non-2xx (400/403/404/422). The CLI's
 * AuthedCommand base layer maps those to user-visible messages — clients never swallow codes.
 */
export class MembersClient {
  private readonly orpc: OpenApiClient

  constructor(http: HttpClient) {
    this.orpc = createOpenApiClient(http, http.baseURL)
  }

  async list(workspaceId: string, q?: { page?: number, limit?: number }): Promise<MemberListResponse> {
    return unwrap(this.orpc.workspaces.byWorkspaceId.members.get({
      params: { workspace_id: workspaceId },
      query: { page: q?.page, limit: q?.limit },
    }))
  }

  async invite(workspaceId: string, payload: MemberInvitePayload): Promise<MemberInviteResponse> {
    return unwrap(this.orpc.workspaces.byWorkspaceId.members.post({
      params: { workspace_id: workspaceId },
      body: payload,
    }))
  }

  async remove(workspaceId: string, memberId: string): Promise<MemberActionResponse> {
    return unwrap(this.orpc.workspaces.byWorkspaceId.members.byMemberId.delete({
      params: { workspace_id: workspaceId, member_id: memberId },
    }))
  }

  async updateRole(
    workspaceId: string,
    memberId: string,
    payload: MemberRoleUpdatePayload,
  ): Promise<MemberActionResponse> {
    return unwrap(this.orpc.workspaces.byWorkspaceId.members.byMemberId.role.put({
      params: { workspace_id: workspaceId, member_id: memberId },
      body: payload,
    }))
  }
}
