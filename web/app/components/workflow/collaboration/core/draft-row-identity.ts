const ids = new WeakMap<object, string>()

export const rememberDraftRow = (row: object, id: string) => ids.set(row, id)
export const draftRowId = (row: unknown) =>
  row && typeof row === 'object' ? ids.get(row) : undefined

export function inheritDraftRowIds(source: unknown, target: unknown) {
  if (
    source === target ||
    !source ||
    !target ||
    typeof source !== 'object' ||
    typeof target !== 'object'
  )
    return
  const id = ids.get(source)
  if (id) ids.set(target, id)
  for (const [key, value] of Object.entries(source))
    inheritDraftRowIds(value, (target as Record<string, unknown>)[key])
}
