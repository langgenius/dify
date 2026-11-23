import { v4 as uuid4 } from 'uuid'

export type AllowlistRow = {
  id: string
  value: string
}

export function createAllowlistRow(value = ''): AllowlistRow {
  return { id: uuid4(), value }
}
