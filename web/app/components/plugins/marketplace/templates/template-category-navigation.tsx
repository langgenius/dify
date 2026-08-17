import type { TemplateCategory } from './categories'
import { cn } from '@langgenius/dify-ui/cn'
import Link from '@/next/link'
import pluginTypeStyles from '../plugin-type-switch.module.css'
import { TEMPLATE_CATEGORIES } from './categories'

export type TemplateCategoryLabels = Record<TemplateCategory, string>

export default function TemplateCategoryNavigation({
  activeCategory,
  ariaLabel,
  labels,
  languages,
  query,
}: {
  activeCategory: TemplateCategory
  ariaLabel: string
  labels: TemplateCategoryLabels
  languages: string[]
  query: string
}) {
  return (
    <nav
      aria-label={ariaLabel}
      className="flex w-full shrink-0 scrollbar-none items-center justify-start gap-1 overflow-x-auto"
    >
      {TEMPLATE_CATEGORIES.map((category) => {
        const searchParams = new URLSearchParams()
        if (query) searchParams.set('q', query)
        if (languages.length) searchParams.set('languages', languages.join(','))
        const queryString = searchParams.toString()
        const href = `/templates/${category}${queryString ? `?${queryString}` : ''}`

        return (
          <Link
            key={category}
            href={href}
            scroll={false}
            aria-current={category === activeCategory ? 'page' : undefined}
            className={cn(
              'flex h-8 min-w-12 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-transparent px-2.5 system-md-medium whitespace-nowrap text-text-tertiary outline-hidden focus-visible:ring-2 focus-visible:ring-state-accent-solid',
              pluginTypeStyles.homeItem,
              category === activeCategory && pluginTypeStyles.homeItemActive,
            )}
          >
            {labels[category]}
          </Link>
        )
      })}
    </nav>
  )
}
