import { z } from 'zod'

const commonSchema = {
  className: z.string().min(1).optional(),
}
export const withIconCardListPropsSchema = z.object(commonSchema).strict()

export const withIconCardItemPropsSchema = z.object({
  ...commonSchema,
  icon: z.string().trim(),
}).strict()

export const directivePropsSchemas = {
  withIconCardListPropsSchema,
  withIconCardItemPropsSchema,
} as const

export type WithIconCardListProps = z.infer<typeof withIconCardListPropsSchema>
export type WithIconCardItemProps = z.infer<typeof withIconCardItemPropsSchema>
