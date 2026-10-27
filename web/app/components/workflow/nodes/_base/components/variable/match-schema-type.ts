export type AnyObj = object | null

const isObj = (x: unknown): x is Record<string, unknown> => x !== null && typeof x === 'object'

// only compare type in object
function matchTheSchemaType(scheme: AnyObj, target: AnyObj): boolean {
  const isMatch = (schema: unknown, t: unknown): boolean => {
    const oSchema = isObj(schema)
    const oT = isObj(t)
    if (!oSchema) return true
    if (!oT) {
      // ignore the object without type
      // deep find oSchema has type
      for (const key in schema) {
        if (key === 'type') return false
        if (isObj(schema[key]) && !isMatch(schema[key], null)) return false
      }
      return true
    }
    // check current `type`
    const tx = schema.type
    const ty = t.type
    const isTypeValueObj = isObj(tx)

    if (!isTypeValueObj) {
      // caution: type can be object, so that it would not be compare by value
      if (tx !== ty) return false
    }

    // recurse into all keys
    const keys = new Set([...Object.keys(schema), ...Object.keys(t)])
    for (const k of keys) {
      if (k === 'type' && !isTypeValueObj) continue // already checked
      if (!isMatch(schema[k], t[k])) return false
    }
    return true
  }

  return isMatch(scheme, target)
}

export default matchTheSchemaType
