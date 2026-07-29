'use client'

import type { ReactNode } from 'react'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { toast } from '@langgenius/dify-ui/toast'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import useDocumentTitle from '@/hooks/use-document-title'
import Link from '@/next/link'
import { usePathname } from '@/next/navigation'
import { consoleQuery } from '@/service/client'
import { newKnowledgeDetailPath, newKnowledgeDocumentsPath, newKnowledgeListPath } from './routes'

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
  const pathname = usePathname()
  const knowledgeSpaceQuery = useQuery({
    ...consoleQuery.knowledgeFs.getKnowledgeSpacesById.queryOptions({
      input: { params: { id: knowledgeSpaceId } },
    }),
    retry: (failureCount, error) => {
      const status = responseStatus(error)
      if (status === 403 || status === 404) return false

      return failureCount < 3
    },
  })
  useDocumentTitle(knowledgeSpaceQuery.data?.name ?? t(($) => $.knowledge))

  if (knowledgeSpaceQuery.isPending)
    return (
      <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center">
        <Loading />
      </div>
    )

  if (knowledgeSpaceQuery.error || !knowledgeSpaceQuery.data) {
    const status = responseStatus(knowledgeSpaceQuery.error)
    const notFound = status === 403 || status === 404
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
          <Button render={<Link href={newKnowledgeListPath} />}>
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

  const sourcesPath = newKnowledgeDetailPath(knowledgeSpaceId)
  const documentsPath = newKnowledgeDocumentsPath(knowledgeSpaceId)
  const sourcesActive = pathname === sourcesPath || pathname.startsWith(`${sourcesPath}/`)
  const documentsActive = pathname === documentsPath || pathname.startsWith(`${documentsPath}/`)
  const showDeferredPage = () => toast.info(t(($) => $['cornerLabel.unavailable']))
  const navItemClassName =
    'flex h-8 shrink-0 items-center gap-2 rounded-lg px-3 system-sm-medium outline-hidden hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid'

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background-body p-1">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-1 overflow-hidden sm:flex-row">
        <aside className="flex shrink-0 flex-col overflow-hidden rounded-lg bg-components-panel-bg shadow-xs sm:w-60">
          <div className="flex h-12 min-w-0 items-center px-1 pr-2">
            <Link
              href={newKnowledgeListPath}
              aria-label={t(($) => $['newKnowledge.backToList'])}
              className="flex h-8 w-10 shrink-0 items-center justify-center rounded-lg text-text-tertiary outline-hidden hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid"
            >
              <span aria-hidden className="i-ri-arrow-left-s-line size-4" />
              <span aria-hidden className="i-ri-home-5-line size-4" />
            </Link>
            <span aria-hidden className="text-text-quaternary">
              /
            </span>
            <span className="truncate px-1.5 system-sm-semibold-uppercase text-text-secondary">
              {t(($) => $.knowledge)}
            </span>
          </div>
          <div className="flex min-w-0 items-center px-1 py-2">
            <div className="flex min-w-0 flex-1 items-center gap-2 rounded-xl p-2">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border-[0.5px] border-divider-regular bg-components-icon-bg-orange-dark-soft">
                <span aria-hidden className="i-ri-book-open-line size-[18px] text-text-tertiary" />
              </div>
              <div className="min-w-0 flex-1">
                <h1 className="truncate system-md-semibold text-text-secondary">
                  {knowledgeSpaceQuery.data.name}
                </h1>
                <p className="mt-0.5 truncate system-2xs-medium-uppercase text-text-tertiary">
                  {t(($) => $['chunkingMode.parentChild'])} ·{' '}
                  {t(($) => $['indexingTechnique.high_quality'])} ·{' '}
                  {t(($) => $['retrieval.semantic_search.title'])}
                </p>
              </div>
            </div>
          </div>
          <nav
            className="flex gap-0.5 overflow-x-auto px-2 py-1 sm:flex-1 sm:flex-col"
            aria-label={knowledgeSpaceQuery.data.name}
          >
            <button
              type="button"
              className={cn(navItemClassName, 'text-text-secondary')}
              onClick={showDeferredPage}
            >
              <span aria-hidden className="i-ri-layout-grid-line size-4" />
              {t(($) => $['newKnowledge.overview'])}
            </button>
            <Link
              href={sourcesPath}
              aria-current={sourcesActive ? 'page' : undefined}
              className={cn(
                navItemClassName,
                sourcesActive ? 'bg-state-base-active text-text-accent' : 'text-text-secondary',
              )}
            >
              <span aria-hidden className="i-ri-links-line size-4" />
              {t(($) => $['newKnowledge.sources'])}
            </Link>
            <Link
              href={documentsPath}
              aria-current={documentsActive ? 'page' : undefined}
              className={cn(
                navItemClassName,
                documentsActive ? 'bg-state-base-active text-text-accent' : 'text-text-secondary',
              )}
            >
              <span aria-hidden className="i-ri-file-text-line size-4" />
              {t(($) => $['newKnowledge.documents'])}
            </Link>
            <button
              type="button"
              className={cn(navItemClassName, 'text-text-secondary')}
              onClick={showDeferredPage}
            >
              <span aria-hidden className="i-ri-test-tube-line size-4" />
              {tCommon(($) => $['datasetMenus.hitTesting'])}
            </button>
            <button
              type="button"
              className={cn(navItemClassName, 'text-text-secondary')}
              onClick={showDeferredPage}
            >
              <span aria-hidden className="i-ri-bar-chart-box-line size-4" />
              {t(($) => $['newKnowledge.quality'])}
            </button>
            <button
              type="button"
              className={cn(navItemClassName, 'text-text-secondary')}
              onClick={showDeferredPage}
            >
              <span aria-hidden className="i-ri-settings-3-line size-4" />
              {tCommon(($) => $['datasetMenus.settings'])}
            </button>
            <button
              type="button"
              className={cn(navItemClassName, 'text-text-secondary')}
              onClick={showDeferredPage}
            >
              <span aria-hidden className="i-ri-code-box-line size-4" />
              {t(($) => $['newKnowledge.apiAgentAccess'])}
            </button>
          </nav>
        </aside>
        <section className="min-h-0 min-w-0 flex-1 overflow-auto rounded-lg bg-components-panel-bg shadow-xs">
          {children}
        </section>
      </div>
    </div>
  )
}
