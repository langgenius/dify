import type { MemberInviteResponse } from '@dify/contracts/api/openapi/types.gen'

export class InviteOutput {
  readonly response: MemberInviteResponse
  readonly textLine: string

  constructor(response: MemberInviteResponse, textLine: string) {
    this.response = response
    this.textLine = textLine
  }

  text(): string {
    return this.textLine
  }

  json(): MemberInviteResponse {
    return this.response
  }

  name(): string {
    return this.response.member_id
  }
}
