'use client'

import type { ReactNode } from 'react'
import type { MainNavProps } from './types'
import type { DetailSidebarMode } from '@/app/components/detail-sidebar/cookie'
import { cn } from '@langgenius/dify-ui/cn'
import { useAtomValue } from 'jotai'
import { useHydrateAtoms } from 'jotai/utils'
import { useTranslation } from 'react-i18next'
import { detailSidebarModeAtom } from '@/app/components/detail-sidebar/state'
import { isCurrentWorkspaceDatasetOperatorAtom } from '@/context/workspace-state'
import { isAgentV2Enabled } from '@/features/agent-v2/feature-flag'
import { usePathname } from '@/next/navigation'
import { MainNav } from '.'
import { MainNavMobileBar } from './mobile-nav'
import { shouldHideMainNavigation, shouldUseDetailSidebar } from './routes'
import { MAIN_CONTENT_ID, SkipLink } from './skip-link'

type MainNavLayoutProps = {
  children: ReactNode
  detailSidebar?: ReactNode
  initialPlatform?: MainNavProps['initialPlatform']
  initialDetailSidebarMode: DetailSidebarMode
}

const MainNavLayout = ({
  children,
  detailSidebar,
  initialPlatform,
  initialDetailSidebarMode,
}: MainNavLayoutProps) => {
  useHydrateAtoms([[detailSidebarModeAtom, initialDetailSidebarMode]])
  const { t } = useTranslation(['common'])
  const pathname = usePathname()
  const isCurrentWorkspaceDatasetOperator = useAtomValue(isCurrentWorkspaceDatasetOperatorAtom)
  const hideMainNavigation = shouldHideMainNavigation(pathname)
  const useDetailSidebar = shouldUseDetailSidebar(pathname, {
    agentV2Enabled: isAgentV2Enabled(),
    isCurrentWorkspaceDatasetOperator,
  })
  const showMainNav = !hideMainNavigation && !useDetailSidebar

  return (
    <div
      className={cn(
        'flex h-0 min-h-0 min-w-0 grow overflow-hidden bg-background-body',
        showMainNav && 'max-md:flex-col',
      )}
    >
      <SkipLink>{t(($) => $['navigation.skipToMain'])}</SkipLink>
      {useDetailSidebar && !hideMainNavigation && detailSidebar}
      {showMainNav && (
        <>
          <MainNavMobileBar />
          <MainNav className="max-md:hidden" initialPlatform={initialPlatform} />
        </>
      )}
      <main
        id={MAIN_CONTENT_ID}
        tabIndex={-1}
        className={cn(
          'flex min-h-0 min-w-0 grow flex-col overflow-hidden outline-hidden focus:outline-hidden focus-visible:outline-hidden',
          pathname.startsWith('/integrations/') && 'max-md:overflow-y-auto',
        )}
      >
        {children}
      </main>
    </div>
  )
}

export default MainNavLayout
