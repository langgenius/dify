import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import Link from '@/next/link'

export const DOCUMENT_DETAIL_TITLE_ID = 'document-detail-title'

export function DocumentDetailHeader({
  action,
  backPath,
  title,
}: {
  action: ReactNode
  backPath: string
  title: string
}) {
  const { t } = useTranslation('dataset')

  return (
    <>
      <div className="flex h-6 items-center">
        <Link
          className="inline-flex w-fit items-center gap-1 system-xs-medium text-text-tertiary hover:text-text-secondary focus-visible:rounded focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
          href={backPath}
        >
          <span aria-hidden className="i-ri-arrow-left-line size-4" />
          {t(($) => $['newKnowledge.documents'])}
        </Link>
      </div>
      <div className="mt-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1
            id={DOCUMENT_DETAIL_TITLE_ID}
            className="truncate title-2xl-semi-bold text-text-primary focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
            tabIndex={-1}
          >
            {title}
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">{action}</div>
      </div>
    </>
  )
}
