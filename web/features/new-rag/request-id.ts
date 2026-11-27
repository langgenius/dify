import { v4 as uuidV4 } from 'uuid'

export function createRequestId() {
  return uuidV4()
}
