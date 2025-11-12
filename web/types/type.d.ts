export type ObjectKeys<T extends Record<string, unknown>> = keyof T
export type ObjectValues<T extends Record<string, unknown>> = T[keyof T]
