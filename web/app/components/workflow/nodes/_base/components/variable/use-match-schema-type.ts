type AnyObj = Record<string, any> | null

// only compare type in object
export function deepEqualByType(a: AnyObj, b: AnyObj): boolean {
  const isObj = (x: any): x is object => x !== null && typeof x === 'object'

  const cmp = (x: AnyObj, y: AnyObj): boolean => {
    const ox = isObj(x)
    const oy = isObj(y)
    if (!ox && !oy) return true // both primitives → ignore values
    if (ox !== oy) { // ignore the object without type
      if(ox && !('type' in (x as object)))
        return true
      return !!(oy && !('type' in (y as object)))
    }
    // check current `type`
    const tx = (x as any).type
    const ty = (y as any).type
    if (tx !== ty) return false

    // recurse into all keys
    const keys = new Set([...Object.keys(x as object), ...Object.keys(y as object)])
    for (const k of keys) {
      if (k === 'type') continue // already checked
      if (!cmp((x as any)[k], (y as any)[k])) return false
    }
    return true
  }

  return cmp(a, b)
}
