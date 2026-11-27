export const CreateFromDSLModalTab = {
  FROM_FILE: 'from-file',
  FROM_URL: 'from-url',
} as const

export type CreateFromDSLModalTab =
  (typeof CreateFromDSLModalTab)[keyof typeof CreateFromDSLModalTab]
