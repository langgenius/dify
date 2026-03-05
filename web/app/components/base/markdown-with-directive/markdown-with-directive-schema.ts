import { z } from 'zod'

export const withIconListDirectivePropsSchema = z.object({
  class: z.string().trim().min(1).optional(),
  mt: z.string().trim().min(1).optional(),
}).strict()

export const withIconItemDirectivePropsSchema = z.object({
  icon: z.string().trim().min(1),
  b: z.string().trim().min(1).optional(),
}).strict()

export const directivePropsSchemas = {
  withiconlist: withIconListDirectivePropsSchema,
  withiconitem: withIconItemDirectivePropsSchema,
} as const

export type WithIconListDirectiveProps = z.infer<typeof withIconListDirectivePropsSchema>
export type WithIconItemDirectiveProps = z.infer<typeof withIconItemDirectivePropsSchema>
