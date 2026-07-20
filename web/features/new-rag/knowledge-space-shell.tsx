'use client'

import type { ReactNode } from 'react'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import useDocumentTitle from '@/hooks/use-document-title'
import Link from '@/next/link'
import { usePathname } from '@/next/navigation'
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

  const sourcesPath = newKnowledgeDetailPath(knowledgeSpaceId)
  const documentsPath = newKnowledgeDocumentsPath(knowledgeSpaceId)
  const sourcesActive = pathname === sourcesPath || pathname.startsWith(`${sourcesPath}/`)
  const documentsActive = pathname === documentsPath || pathname.startsWith(`${documentsPath}/`)
  const navItemClassName =
    'flex h-8 shrink-0 items-center gap-2 rounded-lg px-2 system-sm-medium outline-hidden hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid'

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
          </nav>
        </aside>
        <section className="min-h-0 min-w-0 flex-1 overflow-auto">{children}</section>
      </div>
    </div>
  )
}
