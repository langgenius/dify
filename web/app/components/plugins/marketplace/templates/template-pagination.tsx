import type { TemplateCategory } from './categories'
import Link from '@/next/link'
import { buildTemplatesHref, PAGE_LINK_CLASS, PAGE_LINK_DISABLED_CLASS } from './template-links'

// Server-rendered pagination: plain links keep the search results reachable
// beyond the first page without any client-side state.
export default function TemplatePagination({
  category,
  navigationLabel,
  nextLabel,
  page,
  pageCount,
  previousLabel,
  query,
  sortBy,
  sortOrder,
  view,
}: {
  category: TemplateCategory
  navigationLabel: string
  nextLabel: string
  page: number
  pageCount: number
  previousLabel: string
  query: string
  sortBy?: string
  sortOrder?: string
  view?: string
}) {
  if (pageCount <= 1) return null

  const buildHref = (targetPage: number) =>
    buildTemplatesHref({ category, page: targetPage, query, sortBy, sortOrder, view })

  return (
    <nav aria-label={navigationLabel} className="mt-6 flex items-center justify-center gap-3 pb-4">
      {page > 1 ? (
        <Link href={buildHref(page - 1)} className={PAGE_LINK_CLASS}>
          {previousLabel}
        </Link>
      ) : (
        <span aria-disabled="true" className={PAGE_LINK_DISABLED_CLASS}>
          {previousLabel}
        </span>
      )}
      <span aria-current="page" className="system-sm-regular text-text-tertiary">
        {page} / {pageCount}
      </span>
      {page < pageCount ? (
        <Link href={buildHref(page + 1)} className={PAGE_LINK_CLASS}>
          {nextLabel}
        </Link>
      ) : (
        <span aria-disabled="true" className={PAGE_LINK_DISABLED_CLASS}>
          {nextLabel}
        </span>
      )}
    </nav>
  )
}
