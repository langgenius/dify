export type DraftFieldUpdate<Value> = Value | ((currentValue: Value) => Value)

export const resolveDraftFieldUpdate = <Value>(
  currentValue: Value,
  update: DraftFieldUpdate<Value>,
) => (
  typeof update === 'function'
    ? (update as (currentValue: Value) => Value)(currentValue)
    : update
)
