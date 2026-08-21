'use client'

import type { CSSProperties, ReactNode } from 'react'
import type { KnowledgeFsApiAccessStatus } from './components/knowledge-fs-api-access-dialog'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { DialogTrigger } from '@langgenius/dify-ui/dialog'
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
import { KnowledgeFsApiAccessDialog } from './components/knowledge-fs-api-access-dialog'
import { KnowledgeSpaceIcon } from './components/knowledge-space-icon'
import {
  newKnowledgeDetailPath,
  newKnowledgeDocumentsPath,
  newKnowledgeListPath,
  newKnowledgeOverviewPath,
  newKnowledgeQualityPath,
  newKnowledgeRetrievalTestPath,
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

const knowledgeSpacePageTitle = (
  pathname: string,
  t: ReturnType<typeof useTranslation<'dataset'>>['t'],
  tCommon: ReturnType<typeof useTranslation<'common'>>['t'],
) => {
  const [, root, view, , section, detail] = pathname.split('/')
  if (root !== 'datasets' || view !== 'new') return t(($) => $.knowledge)

  if (!section) return t(($) => $['newKnowledge.overviewTitle'])
  if (section === 'sources' && detail === 'new') return t(($) => $['newKnowledge.addSource'])
  if (section === 'sources') return t(($) => $['newKnowledge.sources'])
  if (section === 'documents') return t(($) => $['newKnowledge.documents'])
  if (section === 'retrieval') return t(($) => $['newKnowledge.retrievalTest.title'])
  if (section === 'quality') return t(($) => $['newKnowledge.quality'])
  if (section === 'settings') return tCommon(($) => $['datasetMenus.settings'])

  return t(($) => $.knowledge)
}

const isDocumentDetailPath = (pathname: string) =>
  /^\/datasets\/new\/[^/]+\/documents\/[^/]+\/?$/.test(pathname)

function KnowledgeSpacePageTitle({ title }: { title: string }) {
  useDocumentTitle(title)

  return null
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
  const [apiAccessDialogOpen, setApiAccessDialogOpen] = useState(false)
  const pathname = usePathname()
  const knowledgeSpaceQuery = useQuery({
    ...consoleQuery.knowledgeFs.spaces.byControlSpaceId.get.queryOptions({
      input: { params: { control_space_id: knowledgeSpaceId } },
      context: { silent: true },
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
  const canManageCredentials = (knowledgeSpaceQuery.data?.permission_keys ?? []).includes(
    'knowledge_space_api_key_manage',
  )
  const externalAccessQuery = useQuery({
    ...consoleQuery.knowledgeFs.spaces.byControlSpaceId.externalAccess.get.queryOptions({
      input: { params: { control_space_id: knowledgeSpaceId } },
    }),
    enabled: canManageAccess && knowledgeSpaceQuery.data?.state === 'active',
  })
  const apiAccessStatus: KnowledgeFsApiAccessStatus = !canManageAccess
    ? 'unavailable'
    : externalAccessQuery.isPending
      ? 'loading'
      : externalAccessQuery.isError || !externalAccessQuery.data
        ? 'unavailable'
        : externalAccessQuery.data.service_api_enabled === true &&
            externalAccessQuery.data.agent_enabled === true
          ? 'active'
          : 'inactive'
  const knowledgeSpaceName =
    knowledgeSpaceQuery.data?.technical_summary?.name ?? t(($) => $.knowledge)
  const pageTitle = knowledgeSpacePageTitle(pathname, t, tCommon)
  const documentTitle = `${pageTitle} · ${knowledgeSpaceName}`
  const documentTitleOwnedByChild =
    isDocumentDetailPath(pathname) &&
    !knowledgeSpaceQuery.isPending &&
    !knowledgeSpaceQuery.error &&
    !!knowledgeSpaceQuery.data
  const pageTitleElement = !documentTitleOwnedByChild ? (
    <KnowledgeSpacePageTitle title={documentTitle} />
  ) : null

  if (knowledgeSpaceQuery.isPending || knowledgeSpaceQuery.data?.state === 'provisioning')
    return (
      <>
        {pageTitleElement}
        <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center">
          <Loading />
        </div>
      </>
    )

  if (knowledgeSpaceQuery.error || !knowledgeSpaceQuery.data) {
    const status = responseStatus(knowledgeSpaceQuery.error)
    const notFound = status === 403 || status === 404
    return (
      <>
        {pageTitleElement}
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
            <Button nativeButton={false} render={<Link href={newKnowledgeListPath} />}>
              {t(($) => $['newKnowledge.backToList'])}
            </Button>
            {!notFound && (
              <Button variant="primary" onClick={() => void knowledgeSpaceQuery.refetch()}>
                {tCommon(($) => $['operation.retry'])}
              </Button>
            )}
          </div>
        </div>
      </>
    )
  }

  const sourcesPath = newKnowledgeDetailPath(knowledgeSpaceId)
  const overviewPath = newKnowledgeOverviewPath(knowledgeSpaceId)
  const documentsPath = newKnowledgeDocumentsPath(knowledgeSpaceId)
  const retrievalTestPath = newKnowledgeRetrievalTestPath(knowledgeSpaceId)
  const qualityPath = newKnowledgeQualityPath(knowledgeSpaceId)
  const settingsPath = newKnowledgeSettingsPath(knowledgeSpaceId)
  const overviewActive = pathname === overviewPath
  const sourcesActive = pathname === sourcesPath || pathname.startsWith(`${sourcesPath}/`)
  const documentsActive = pathname === documentsPath || pathname.startsWith(`${documentsPath}/`)
  const retrievalTestActive =
    pathname === retrievalTestPath || pathname.startsWith(`${retrievalTestPath}/`)
  const qualityActive = pathname === qualityPath || pathname.startsWith(`${qualityPath}/`)
  const settingsActive = pathname === settingsPath || pathname.startsWith(`${settingsPath}/`)
  const navItemClassName =
    'flex h-8 shrink-0 items-center gap-2 rounded-lg pr-1 pl-3 system-sm-medium outline-hidden hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid'
  const navIcon = (className: string) => (
    <span aria-hidden className="flex size-5 shrink-0 items-center justify-center">
      <span className={cn('size-4.5', className)} />
    </span>
  )

  return (
    <div
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background-body py-1"
      style={
        {
          '--new-rag-sidebar-width': sidebarExpanded ? '248px' : '64px',
        } as CSSProperties
      }
    >
      {pageTitleElement}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-1 overflow-hidden pl-1 sm:flex-row">
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
                    href="/"
                    aria-label={tCommon(($) => $['mainNav.home'])}
                    className="flex shrink-0 items-center rounded-lg py-2 pr-1.5 pl-0.5 text-text-tertiary outline-hidden transition-colors hover:bg-state-base-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid"
                  >
                    <span aria-hidden className="i-ri-arrow-left-s-line size-4" />
                    <span aria-hidden className="i-ri-home-5-line size-4" />
                  </Link>
                  <span aria-hidden className="system-md-regular text-text-quaternary">
                    /
                  </span>
                  <Link
                    href={newKnowledgeListPath}
                    className="truncate rounded-lg px-1.5 py-2 system-sm-semibold-uppercase text-text-secondary outline-hidden transition-colors hover:bg-state-base-hover hover:text-text-primary focus-visible:ring-2 focus-visible:ring-state-accent-solid"
                  >
                    {t(($) => $.knowledge)}
                  </Link>
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
                background={knowledgeSpaceQuery.data.technical_summary?.icon_background}
                icon={knowledgeSpaceQuery.data.technical_summary?.icon}
                size="medium"
              />
              {sidebarExpanded && (
                <div className="flex min-w-0 flex-1">
                  <h1 className="truncate system-md-semibold text-text-secondary">
                    {knowledgeSpaceName}
                  </h1>
                </div>
              )}
            </div>
          </div>
          <nav
            className="grid grid-cols-3 gap-0.5 px-2 py-1 sm:flex sm:flex-1 sm:flex-col"
            aria-label={knowledgeSpaceName}
          >
            <Link
              href={overviewPath}
              aria-label={t(($) => $['newKnowledge.overviewTitle'])}
              aria-current={overviewActive ? 'page' : undefined}
              className={cn(
                navItemClassName,
                sidebarExpanded ? 'justify-start' : 'justify-center px-0',
                overviewActive
                  ? 'bg-components-menu-item-bg-active font-semibold text-text-accent'
                  : 'text-text-secondary',
              )}
            >
              {navIcon(overviewActive ? 'i-ri-layout-grid-fill' : 'i-ri-layout-grid-line')}
              {sidebarExpanded && t(($) => $['newKnowledge.overviewTitle'])}
            </Link>
            <Link
              href={sourcesPath}
              aria-label={t(($) => $['newKnowledge.sourceColumn'])}
              aria-current={sourcesActive ? 'page' : undefined}
              className={cn(
                navItemClassName,
                sidebarExpanded ? 'justify-start' : 'justify-center px-0',
                sourcesActive
                  ? 'bg-components-menu-item-bg-active font-semibold text-text-accent'
                  : 'text-text-secondary',
              )}
            >
              {navIcon(sourcesActive ? 'i-ri-book-open-fill' : 'i-ri-book-open-line')}
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
                  ? 'bg-components-menu-item-bg-active font-semibold text-text-accent'
                  : 'text-text-secondary',
              )}
            >
              {navIcon(documentsActive ? 'i-ri-file-text-fill' : 'i-ri-file-text-line')}
              {sidebarExpanded && t(($) => $['newKnowledge.documentColumn'])}
            </Link>
            <Link
              href={retrievalTestPath}
              aria-label={t(($) => $['newKnowledge.retrievalTest.title'])}
              aria-current={retrievalTestActive ? 'page' : undefined}
              className={cn(
                navItemClassName,
                sidebarExpanded ? 'justify-start' : 'justify-center px-0',
                retrievalTestActive
                  ? 'bg-components-menu-item-bg-active font-semibold text-text-accent'
                  : 'text-text-secondary',
              )}
            >
              {navIcon(retrievalTestActive ? 'i-ri-search-eye-fill' : 'i-ri-search-eye-line')}
              {sidebarExpanded && t(($) => $['newKnowledge.retrievalTest.title'])}
            </Link>
            <Link
              href={qualityPath}
              aria-label={t(($) => $['newKnowledge.quality'])}
              aria-current={qualityActive ? 'page' : undefined}
              className={cn(
                navItemClassName,
                sidebarExpanded ? 'justify-start' : 'justify-center px-0',
                qualityActive
                  ? 'bg-components-menu-item-bg-active font-semibold text-text-accent'
                  : 'text-text-secondary',
              )}
            >
              {navIcon(qualityActive ? 'i-ri-shield-check-fill' : 'i-ri-shield-check-line')}
              {sidebarExpanded && t(($) => $['newKnowledge.quality'])}
            </Link>
            <Link
              href={settingsPath}
              aria-label={tCommon(($) => $['datasetMenus.settings'])}
              aria-current={settingsActive ? 'page' : undefined}
              className={cn(
                navItemClassName,
                sidebarExpanded ? 'justify-start' : 'justify-center px-0',
                settingsActive
                  ? 'bg-components-menu-item-bg-active font-semibold text-text-accent'
                  : 'text-text-secondary',
              )}
            >
              {navIcon(settingsActive ? 'i-ri-equalizer-2-fill' : 'i-ri-equalizer-2-line')}
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
              onClick={() => setApiAccessDialogOpen(true)}
            >
              {navIcon('i-custom-vender-knowledge-api-aggregate')}
              {sidebarExpanded && (
                <span className="min-w-0 flex-1 truncate text-left">
                  {t(($) => $['newKnowledge.apiAgentAccess'])}
                </span>
              )}
              <span className="sr-only">
                {t(($) =>
                  apiAccessStatus === 'active'
                    ? $['newKnowledge.apiAccessActive']
                    : apiAccessStatus === 'inactive'
                      ? $['newKnowledge.apiAccessInactive']
                      : $.unavailable,
                )}
              </span>
              <span
                aria-hidden
                className={cn(
                  'size-2 shrink-0 rounded-full',
                  apiAccessStatus === 'active'
                    ? 'bg-util-colors-green-green-500'
                    : 'bg-text-quaternary',
                  apiAccessStatus === 'loading' && 'animate-pulse motion-reduce:animate-none',
                )}
              />
            </Button>
          </div>
        </aside>
        <section className="@container/knowledge-content mx-1 flex min-h-0 min-w-0 flex-1 overflow-hidden rounded-lg bg-components-panel-bg shadow-xs">
          {children}
        </section>
      </div>
      <KnowledgeFsApiAccessDialog
        canManageCredentials={canManageCredentials}
        status={apiAccessStatus}
        knowledgeSpaceId={knowledgeSpaceId}
        open={apiAccessDialogOpen}
        onOpenChange={setApiAccessDialogOpen}
      />
    </div>
  )
}
