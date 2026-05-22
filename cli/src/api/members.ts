import type {
  MemberActionResponse,
  MemberInvitePayload,
  MemberInviteResponse,
  MemberListResponse,
  MemberRoleUpdatePayload,
} from '@dify/contracts/api/openapi/types.gen'
import type { KyInstance } from 'ky'

/**
 * Thin client for /openapi/v1/workspaces/<id>/members.
 *
 * Errors are surfaced as ky HTTPErrors with the server's status code
 * (400/403/404/422). The CLI's AuthedCommand base layer maps those to
 * user-visible messages — clients never swallow status codes here.
 */
export class MembersClient {
  private readonly http: KyInstance

  constructor(http: KyInstance) {
    this.http = http
  }

  async list(workspaceId: string, q?: { page?: number, limit?: number }): Promise<MemberListResponse> {
    const params = new URLSearchParams()
    if (q?.page !== undefined)
      params.set('page', String(q.page))
    if (q?.limit !== undefined)
      params.set('limit', String(q.limit))
    const hasParams = Array.from(params.keys()).length > 0
    const opts = hasParams ? { searchParams: params } : undefined
    return this.http
      .get(`workspaces/${encodeURIComponent(workspaceId)}/members`, opts)
      .json<MemberListResponse>()
  }

  async invite(workspaceId: string, payload: MemberInvitePayload): Promise<MemberInviteResponse> {
    return this.http
      .post(`workspaces/${encodeURIComponent(workspaceId)}/members`, { json: payload })
      .json<MemberInviteResponse>()
  }

  async remove(workspaceId: string, memberId: string): Promise<MemberActionResponse> {
    return this.http
      .delete(`workspaces/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(memberId)}`)
      .json<MemberActionResponse>()
  }

  async updateRole(
    workspaceId: string,
    memberId: string,
    payload: MemberRoleUpdatePayload,
  ): Promise<MemberActionResponse> {
    return this.http
      .put(
        `workspaces/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(memberId)}/role`,
        { json: payload },
      )
      .json<MemberActionResponse>()
  }
}
