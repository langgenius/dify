import { v4 as uuidV4 } from 'uuid'

export function createRequestId() {
  return globalThis.crypto?.randomUUID?.() ?? uuidV4()
}
