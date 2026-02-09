export function ObjectFromEntries<const T extends ReadonlyArray<readonly [PropertyKey, unknown]>>(entries: T): { [K in T[number]as K[0]]: K[1] } {
  return Object.fromEntries(entries) as { [K in T[number]as K[0]]: K[1] }
}

export function ObjectKeys<const T extends Record<string, unknown>>(obj: T): (keyof T)[] {
  return Object.keys(obj) as (keyof T)[]
}
