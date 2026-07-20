'use client'

import type { ReactNode } from 'react'
import { Button } from '@langgenius/dify-ui/button'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import useDocumentTitle from '@/hooks/use-document-title'
import Link from '@/next/link'
import { consoleQuery } from '@/service/client'
import { newKnowledgeDetailPath, newKnowledgeDocumentsPath } from './routes'

function responseStatus(error: unknown) {
  if (error instanceof Response) return error.status
  if (error && typeof error === 'object' && 'status' in error) return error.status
  if (error && typeof error === 'object' && 'data' in error) {
    const data = error.data
    if (data && typeof data === 'object' && 'status' in data) return data.status
  }
}

export function KnowledgeSpaceShell({
  children,
  knowledgeSpaceId,
}: {
  children: ReactNode
  knowledgeSpaceId: string
}) {
  const { t } = useTranslation('dataset')
  const { t: tCommon } = useTranslation('common')
  const knowledgeSpaceQuery = useQuery(
    consoleQuery.knowledgeFs.getKnowledgeSpacesById.queryOptions({
      input: { params: { id: knowledgeSpaceId } },
    }),
  )
  useDocumentTitle(knowledgeSpaceQuery.data?.name ?? t(($) => $.knowledge))

  if (knowledgeSpaceQuery.isPending)
    return (
      <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center">
        <Loading />
      </div>
    )

  if (knowledgeSpaceQuery.error || !knowledgeSpaceQuery.data) {
    const notFound = responseStatus(knowledgeSpaceQuery.error) === 404
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center px-6 text-center">
        <span aria-hidden className="i-ri-book-open-line size-8 text-text-tertiary" />
        <h1 className="mt-4 title-2xl-semi-bold text-text-primary">
          {t(($) =>
            notFound ? $['newKnowledge.notFoundTitle'] : $['newKnowledge.detailErrorTitle'],
          )}
        </h1>
        <p className="mt-2 max-w-md body-sm-regular text-text-tertiary">
          {t(($) =>
            notFound
              ? $['newKnowledge.notFoundDescription']
              : $['newKnowledge.detailErrorDescription'],
          )}
        </p>
        <div className="mt-5 flex gap-2">
          <Button render={<Link href="/datasets?view=new" />}>
            {t(($) => $['newKnowledge.backToList'])}
          </Button>
          {!notFound && (
            <Button variant="primary" onClick={() => void knowledgeSpaceQuery.refetch()}>
              {tCommon(($) => $['operation.retry'])}
            </Button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background-body p-1">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg bg-components-panel-bg shadow-xs sm:flex-row">
        <aside className="flex shrink-0 flex-col border-b border-divider-subtle sm:w-56 sm:border-r sm:border-b-0">
          <div className="flex h-13 min-w-0 items-center gap-2 border-b border-divider-subtle px-3">
            <Link
              href="/datasets?view=new"
              aria-label={t(($) => $['newKnowledge.backToList'])}
              className="flex size-8 shrink-0 items-center justify-center rounded-lg text-text-tertiary outline-hidden hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid"
            >
              <span aria-hidden className="i-ri-arrow-left-line size-4" />
            </Link>
            <h1 className="truncate system-md-semibold text-text-primary">
              {knowledgeSpaceQuery.data.name}
            </h1>
          </div>
          <nav
            className="flex gap-1 overflow-x-auto p-2 sm:flex-col"
            aria-label={knowledgeSpaceQuery.data.name}
          >
            <Link
              href={newKnowledgeDetailPath(knowledgeSpaceId)}
              className="flex h-8 shrink-0 items-center gap-2 rounded-lg px-2 system-sm-medium text-text-secondary outline-hidden hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid"
            >
              <span aria-hidden className="i-ri-links-line size-4" />
              {t(($) => $['newKnowledge.sources'])}
            </Link>
            <Link
              href={newKnowledgeDocumentsPath(knowledgeSpaceId)}
              className="flex h-8 shrink-0 items-center gap-2 rounded-lg px-2 system-sm-medium text-text-secondary outline-hidden hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid"
            >
              <span aria-hidden className="i-ri-file-text-line size-4" />
              {t(($) => $['newKnowledge.documents'])}
            </Link>
          </nav>
        </aside>
        <section className="min-h-0 min-w-0 flex-1 overflow-auto">{children}</section>
      </div>
    </div>
  )
}
