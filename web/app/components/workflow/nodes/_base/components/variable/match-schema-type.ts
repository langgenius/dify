export type AnyObj = Record<string, any> | null

const isObj = (x: any): x is object => x !== null && typeof x === 'object'

// only compare type in object
function matchTheSchemaType(scheme: AnyObj, target: AnyObj): boolean {
  const isMatch = (schema: AnyObj, t: AnyObj): boolean => {
    const oSchema = isObj(schema)
    const oT = isObj(t)
    if (!oSchema)
      return true
    if (!oT) { // ignore the object without type
      // deep find oSchema has type
      for (const key in schema) {
        if (key === 'type')
          return false
        if (isObj((schema as any)[key]) && !isMatch((schema as any)[key], null))
          return false
      }
      return true
    }
    // check current `type`
    const tx = (schema as any).type
    const ty = (t as any).type
    const isTypeValueObj = isObj(tx)

    if (!isTypeValueObj) { // caution: type can be object, so that it would not be compare by value
      if (tx !== ty)
        return false
    }

    // recurse into all keys
    const keys = new Set([...Object.keys(schema as object), ...Object.keys(t as object)])
    for (const k of keys) {
      if (k === 'type' && !isTypeValueObj)
        continue // already checked
      if (!isMatch((schema as any)[k], (t as any)[k]))
        return false
    }
    return true
  }

  return isMatch(scheme, target)
}

export default matchTheSchemaType
