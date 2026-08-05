export type DeletedMemberPayload = {
  readonly id: string
  readonly deleted: true
}

export class DeleteMemberOutput {
  readonly payload: DeletedMemberPayload
  readonly textLine: string

  constructor(memberId: string, textLine: string) {
    this.payload = { id: memberId, deleted: true }
    this.textLine = textLine
  }

  text(): string {
    return this.textLine
  }

  json(): DeletedMemberPayload {
    return this.payload
  }

  name(): string {
    return this.payload.id
  }
}
