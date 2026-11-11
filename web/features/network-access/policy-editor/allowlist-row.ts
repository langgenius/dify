export type AllowlistRow = {
  id: string
  value: string
}

export function createAllowlistRow(value = ''): AllowlistRow {
  return { id: crypto.randomUUID(), value }
}
