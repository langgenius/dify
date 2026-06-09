import type {
  MemberActionResponse,
  MemberInvitePayload,
  MemberInviteResponse,
  MemberListResponse,
  MemberRoleUpdatePayload,
} from '@dify/contracts/api/openapi/types.gen'
import type { HttpClient } from '@/http/types'

/**
 * Thin client for /openapi/v1/workspaces/<id>/members.
 *
 * Errors are surfaced as BaseError via classifyResponse on non-2xx
 * (400/403/404/422). The CLI's AuthedCommand base layer maps those to
 * user-visible messages — clients never swallow status codes here.
 */
export class MembersClient {
  private readonly http: HttpClient

  constructor(http: HttpClient) {
    this.http = http
  }

  async list(workspaceId: string, q?: { page?: number, limit?: number }): Promise<MemberListResponse> {
    return this.http.get<MemberListResponse>(
      `workspaces/${encodeURIComponent(workspaceId)}/members`,
      { searchParams: { page: q?.page, limit: q?.limit } },
    )
  }

  async invite(workspaceId: string, payload: MemberInvitePayload): Promise<MemberInviteResponse> {
    return this.http.post<MemberInviteResponse>(
      `workspaces/${encodeURIComponent(workspaceId)}/members`,
      { json: payload },
    )
  }

  async remove(workspaceId: string, memberId: string): Promise<MemberActionResponse> {
    return this.http.delete<MemberActionResponse>(
      `workspaces/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(memberId)}`,
    )
  }

  async updateRole(
    workspaceId: string,
    memberId: string,
    payload: MemberRoleUpdatePayload,
  ): Promise<MemberActionResponse> {
    return this.http.put<MemberActionResponse>(
      `workspaces/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(memberId)}/role`,
      { json: payload },
    )
  }
}
