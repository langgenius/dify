export const TypeEnum = {
  TRY: 'try',
  DETAIL: 'detail',
} as const

export type TypeEnum = (typeof TypeEnum)[keyof typeof TypeEnum]
