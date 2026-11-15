export const GeneratorType = {
  prompt: 'prompt',
  code: 'code',
} as const

export type GeneratorType = (typeof GeneratorType)[keyof typeof GeneratorType]
