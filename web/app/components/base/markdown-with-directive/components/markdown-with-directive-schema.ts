import * as z from 'zod'

const commonSchema = {
  className: z.string().min(1).optional(),
}
export const withIconCardListPropsSchema = z.object(commonSchema).strict()

const HTTP_URL_REGEX = /^https?:\/\//i

export const withIconCardItemPropsSchema = z.object({
  ...commonSchema,
  icon: z.string().trim().url().refine(
    value => HTTP_URL_REGEX.test(value),
    'icon must be a http/https URL',
  ),
}).strict()

export const directivePropsSchemas = {
  withiconcardlist: withIconCardListPropsSchema,
  withiconcarditem: withIconCardItemPropsSchema,
} as const

export type DirectiveName = keyof typeof directivePropsSchemas

function isDirectiveName(name: string): name is DirectiveName {
  return Object.hasOwn(directivePropsSchemas, name)
}

export function validateDirectiveProps(name: string, attributes: Record<string, string>): boolean {
  if (!isDirectiveName(name)) {
    console.error('[markdown-with-directive] Unknown directive name.', {
      attributes,
      directive: name,
    })
    return false
  }

  const parsed = directivePropsSchemas[name].safeParse(attributes)
  if (!parsed.success) {
    console.error('[markdown-with-directive] Invalid directive props.', {
      attributes,
      directive: name,
      issues: parsed.error.issues.map(issue => ({
        code: issue.code,
        message: issue.message,
        path: issue.path.join('.'),
      })),
    })
    return false
  }

  return true
}

export type WithIconCardListProps = z.infer<typeof withIconCardListPropsSchema>
export type WithIconCardItemProps = z.infer<typeof withIconCardItemPropsSchema>
