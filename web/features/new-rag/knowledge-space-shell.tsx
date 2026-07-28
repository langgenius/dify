'use client'

import type { CSSProperties, ReactNode } from 'react'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { DialogTrigger } from '@langgenius/dify-ui/dialog'
import { toast } from '@langgenius/dify-ui/toast'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import SidebarLeftArrowIcon from '@/app/components/base/icons/src/vender/SidebarLeftArrowIcon'
import Loading from '@/app/components/base/loading'
import { DetailSidebarToggleButton } from '@/app/components/detail-sidebar/toggle-button'
import { gotoAnythingDialogHandle } from '@/app/components/goto-anything/dialog-handle'
import useDocumentTitle from '@/hooks/use-document-title'
import Link from '@/next/link'
import { usePathname } from '@/next/navigation'
import { consoleQuery } from '@/service/client'
import { KnowledgeSpaceIcon } from './components/knowledge-space-icon'
import {
  newKnowledgeDetailPath,
  newKnowledgeDocumentsPath,
  newKnowledgeListPath,
  newKnowledgeSettingsPath,
} from './routes'

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
  const { t: tApp } = useTranslation('app')
  const [sidebarExpanded, setSidebarExpanded] = useState(true)
  const pathname = usePathname()
  const knowledgeSpaceQuery = useQuery({
    ...consoleQuery.knowledgeFs.spaces.byControlSpaceId.get.queryOptions({
      input: { params: { control_space_id: knowledgeSpaceId } },
    }),
    refetchInterval: (query) => (query.state.data?.state === 'provisioning' ? 1000 : false),
    retry: (failureCount, error) => {
      const status = responseStatus(error)
      if (status === 403 || status === 404) return false

      return failureCount < 3
    },
  })
  const canManageAccess = (knowledgeSpaceQuery.data?.permission_keys ?? []).includes(
    'knowledge_space_access_config',
  )
  const externalAccessQuery = useQuery({
    ...consoleQuery.knowledgeFs.spaces.byControlSpaceId.externalAccess.get.queryOptions({
      input: { params: { control_space_id: knowledgeSpaceId } },
    }),
    enabled: canManageAccess && knowledgeSpaceQuery.data?.state === 'active',
  })
  const apiAccessEnabled =
    externalAccessQuery.data?.service_api_enabled === true &&
    externalAccessQuery.data.agent_enabled === true
  const knowledgeSpaceName =
    knowledgeSpaceQuery.data?.technical_summary?.name ?? t(($) => $.knowledge)
  useDocumentTitle(knowledgeSpaceName)

  if (knowledgeSpaceQuery.isPending || knowledgeSpaceQuery.data?.state === 'provisioning')
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
  const settingsPath = newKnowledgeSettingsPath(knowledgeSpaceId)
  const sourcesActive = pathname === sourcesPath || pathname.startsWith(`${sourcesPath}/`)
  const documentsActive = pathname === documentsPath || pathname.startsWith(`${documentsPath}/`)
  const settingsActive = pathname === settingsPath || pathname.startsWith(`${settingsPath}/`)
  const showDeferredPage = () => toast.info(t(($) => $['cornerLabel.unavailable']))
  const navItemClassName =
    'flex h-8 shrink-0 items-center gap-2 rounded-lg pr-1 pl-3 system-sm-medium outline-hidden hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid'
  const navIcon = (className: string) => (
    <span aria-hidden className="flex size-5 shrink-0 items-center justify-center">
      <span className={cn('size-[18px]', className)} />
    </span>
  )

  return (
    <div
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background-body p-1"
      style={
        {
          '--new-rag-sidebar-width': sidebarExpanded ? '248px' : '64px',
        } as CSSProperties
      }
    >
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 overflow-hidden sm:flex-row">
        <aside
          className={cn(
            'flex shrink-0 flex-col overflow-hidden rounded-lg bg-components-panel-bg shadow-xs transition-[width] motion-reduce:transition-none',
            sidebarExpanded ? 'sm:w-60' : 'sm:w-14',
          )}
        >
          <div
            className={cn(
              'flex h-12 min-w-0 items-center',
              sidebarExpanded ? 'py-2 pr-2 pl-1' : 'justify-center px-3 pt-2 pb-1',
            )}
          >
            {sidebarExpanded && (
              <>
                <div className="flex min-w-0 flex-1 items-center gap-px">
                  <Link
                    href={newKnowledgeListPath}
                    aria-label={t(($) => $['newKnowledge.backToList'])}
                    className="flex shrink-0 items-center rounded-lg py-2 pr-1.5 pl-0.5 text-text-tertiary outline-hidden transition-colors hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid"
                  >
                    <span aria-hidden className="i-ri-arrow-left-s-line size-4" />
                    <span aria-hidden className="i-ri-home-5-line size-4" />
                  </Link>
                  <span aria-hidden className="system-md-regular text-text-quaternary">
                    /
                  </span>
                  <span className="truncate px-1.5 py-2 system-sm-semibold-uppercase text-text-secondary">
                    {t(($) => $.knowledge)}
                  </span>
                </div>
                <DialogTrigger
                  handle={gotoAnythingDialogHandle}
                  render={
                    <button
                      type="button"
                      aria-label={tApp(($) => $['gotoAnything.searchTitle'])}
                      className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-[10px] text-text-tertiary outline-hidden transition-colors hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid"
                    >
                      <span aria-hidden className="i-custom-vender-main-nav-quick-search size-4" />
                    </button>
                  }
                />
              </>
            )}
            <DetailSidebarToggleButton
              expand={sidebarExpanded}
              onToggle={() => setSidebarExpanded((expanded) => !expanded)}
              icon={<SidebarLeftArrowIcon aria-hidden className="size-4" />}
              className="size-8 rounded-[10px] border-0 bg-transparent px-0 text-text-tertiary shadow-none hover:border-0 hover:bg-state-base-hover hover:text-text-secondary"
            />
          </div>
          <div className="flex min-w-0 items-center px-1 py-2">
            <div
              className={cn(
                'flex min-w-0 flex-1 items-center rounded-xl p-2',
                sidebarExpanded ? 'gap-2' : 'justify-center',
              )}
            >
              <KnowledgeSpaceIcon
                icon={knowledgeSpaceQuery.data.technical_summary?.icon}
                size="medium"
              />
              {sidebarExpanded && (
                <div className="min-w-0 flex-1">
                  <h1 className="truncate system-md-semibold text-text-secondary">
                    {knowledgeSpaceName}
                  </h1>
                  <p className="mt-0.5 truncate system-2xs-medium-uppercase text-text-tertiary">
                    {t(($) => $['chunkingMode.parentChild'])} ·{' '}
                    {t(($) => $['indexingTechnique.high_quality'])} ·{' '}
                    {t(($) => $['retrieval.semantic_search.title'])}
                  </p>
                </div>
              )}
            </div>
          </div>
          <nav
            className="flex gap-0.5 overflow-x-auto px-2 py-1 sm:flex-1 sm:flex-col"
            aria-label={knowledgeSpaceName}
          >
            <Button
              aria-label={t(($) => $['newKnowledge.overview'])}
              variant="ghost"
              className={cn(
                navItemClassName,
                sidebarExpanded ? 'justify-start' : 'justify-center px-0',
                'text-text-secondary',
              )}
              onClick={showDeferredPage}
            >
              {navIcon('i-ri-layout-grid-line')}
              {sidebarExpanded && t(($) => $['newKnowledge.overview'])}
            </Button>
            <Link
              href={sourcesPath}
              aria-label={t(($) => $['newKnowledge.sourceColumn'])}
              aria-current={sourcesActive ? 'page' : undefined}
              className={cn(
                navItemClassName,
                sidebarExpanded ? 'justify-start' : 'justify-center px-0',
                sourcesActive
                  ? 'bg-state-base-active font-semibold text-text-accent'
                  : 'text-text-secondary',
              )}
            >
              {navIcon('i-ri-book-open-line')}
              {sidebarExpanded && t(($) => $['newKnowledge.sourceColumn'])}
            </Link>
            <Link
              href={documentsPath}
              aria-label={t(($) => $['newKnowledge.documentColumn'])}
              aria-current={documentsActive ? 'page' : undefined}
              className={cn(
                navItemClassName,
                sidebarExpanded ? 'justify-start' : 'justify-center px-0',
                documentsActive
                  ? 'bg-state-base-active font-semibold text-text-accent'
                  : 'text-text-secondary',
              )}
            >
              {navIcon('i-ri-file-text-line')}
              {sidebarExpanded && t(($) => $['newKnowledge.documentColumn'])}
            </Link>
            <Button
              aria-label={t(($) => $['newKnowledge.evidence'])}
              variant="ghost"
              className={cn(
                navItemClassName,
                sidebarExpanded ? 'justify-start' : 'justify-center px-0',
                'text-text-secondary',
              )}
              onClick={showDeferredPage}
            >
              {navIcon('i-ri-search-eye-line')}
              {sidebarExpanded && t(($) => $['newKnowledge.evidence'])}
            </Button>
            <Button
              aria-label={t(($) => $['newKnowledge.quality'])}
              variant="ghost"
              className={cn(
                navItemClassName,
                sidebarExpanded ? 'justify-start' : 'justify-center px-0',
                'text-text-secondary',
              )}
              onClick={showDeferredPage}
            >
              {navIcon('i-ri-shield-check-line')}
              {sidebarExpanded && t(($) => $['newKnowledge.quality'])}
            </Button>
            <Link
              href={settingsPath}
              aria-label={tCommon(($) => $['datasetMenus.settings'])}
              aria-current={settingsActive ? 'page' : undefined}
              className={cn(
                navItemClassName,
                sidebarExpanded ? 'justify-start' : 'justify-center px-0',
                settingsActive
                  ? 'bg-state-base-active font-semibold text-text-accent'
                  : 'text-text-secondary',
              )}
            >
              {navIcon('i-ri-equalizer-2-line')}
              {sidebarExpanded && tCommon(($) => $['datasetMenus.settings'])}
            </Link>
          </nav>
          <div className={cn('shrink-0 py-2', sidebarExpanded ? 'px-3' : 'px-2')}>
            <Button
              aria-label={t(($) => $['newKnowledge.apiAgentAccess'])}
              variant="ghost"
              className={cn(
                navItemClassName,
                'w-full border-[0.5px] border-components-panel-border text-text-secondary',
                sidebarExpanded ? 'justify-start' : 'justify-center px-0',
              )}
              onClick={showDeferredPage}
            >
              {navIcon('i-custom-vender-knowledge-api-aggregate')}
              {sidebarExpanded && (
                <span className="min-w-0 flex-1 truncate text-left">
                  {t(($) => $['newKnowledge.apiAgentAccess'])}
                </span>
              )}
              <span className="sr-only">
                {t(($) =>
                  apiAccessEnabled
                    ? $['newKnowledge.apiAccessActive']
                    : $['newKnowledge.apiAccessInactive'],
                )}
              </span>
              <span
                aria-hidden
                className={cn(
                  'size-2 shrink-0 rounded-full',
                  apiAccessEnabled ? 'bg-util-colors-green-green-500' : 'bg-text-quaternary',
                )}
              />
            </Button>
          </div>
        </aside>
        <section className="min-h-0 min-w-0 flex-1 overflow-auto rounded-lg bg-components-panel-bg shadow-xs">
          {children}
        </section>
      </div>
    </div>
  )
}
