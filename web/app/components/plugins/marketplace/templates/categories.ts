export const TEMPLATE_CATEGORIES = [
  'all',
  'marketing',
  'sales',
  'support',
  'operations',
  'it',
  'knowledge',
  'design',
  'others',
] as const

export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number]

export function isTemplateCategory(value: string | undefined): value is TemplateCategory {
  return TEMPLATE_CATEGORIES.includes(value as TemplateCategory)
}
