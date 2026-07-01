'use client'

import type { ReactNode } from 'react'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import { useStore as useAppStore } from '@/app/components/app/store'
import { useAppContext } from '@/context/app-context'
import { isAgentV2Enabled } from '@/features/agent-v2/feature-flag'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { usePathname } from '@/next/navigation'
import { MainNav } from '.'
import { shouldUseDetailSidebar } from './routes'
import { MainContent, SkipNav } from './skip-nav'

type MainNavLayoutProps = {
  children: ReactNode
}

function AppDetailStoreCleanup() {
  const pathname = usePathname()
  const { hasAppDetail, setAppDetail } = useAppStore(useShallow(state => ({
    hasAppDetail: !!state.appDetail,
    setAppDetail: state.setAppDetail,
  })))

  useEffect(() => {
    if (pathname.startsWith('/app/') || !hasAppDetail)
      return

    setAppDetail()
  }, [hasAppDetail, pathname, setAppDetail])

  return null
}

const MainNavLayout = ({
  children,
}: MainNavLayoutProps) => {
  const { t } = useTranslation('common')
  const pathname = usePathname()
  const { isCurrentWorkspaceDatasetOperator, isCurrentWorkspaceEditor } = useAppContext()
  const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())
  const shouldHideMainNav = shouldUseDetailSidebar(pathname, {
    agentV2Enabled: isAgentV2Enabled(),
    canUseAppDeploy: isCurrentWorkspaceEditor && systemFeatures.enable_app_deploy,
    isCurrentWorkspaceDatasetOperator,
  })

  return (
    <div className="flex h-0 min-h-0 min-w-0 grow overflow-hidden bg-background-body">
      <SkipNav>{t('navigation.skipToMain')}</SkipNav>
      <AppDetailStoreCleanup />
      {!shouldHideMainNav && <MainNav />}
      {shouldHideMainNav
        ? children
        : <MainContent>{children}</MainContent>}
    </div>
  )
}

export default MainNavLayout
