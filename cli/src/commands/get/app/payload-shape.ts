export function isPayloadShape<T>(value: unknown, requiredKey: keyof T): value is T {
  return typeof value === 'object'
    && value !== null
    && requiredKey in value
}
