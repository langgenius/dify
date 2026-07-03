export type SetMemberPayload = {
  readonly id: string
  readonly role: 'normal' | 'admin'
}

export class SetMemberOutput {
  readonly payload: SetMemberPayload
  readonly textLine: string

  constructor(payload: SetMemberPayload, textLine: string) {
    this.payload = payload
    this.textLine = textLine
  }

  text(): string {
    return this.textLine
  }

  json(): SetMemberPayload {
    return this.payload
  }

  name(): string {
    return this.payload.id
  }
}
