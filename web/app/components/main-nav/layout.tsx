'use client'

import type { ReactNode } from 'react'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import { useStore as useAppStore } from '@/app/components/app/store'
import {
  isCurrentWorkspaceDatasetOperatorAtom,
  isCurrentWorkspaceEditorAtom,
} from '@/context/workspace-state'
import { isAgentV2Enabled } from '@/features/agent-v2/feature-flag'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { usePathname } from '@/next/navigation'
import { MainNav } from '.'
import { shouldUseDetailSidebar } from './routes'
import { MAIN_CONTENT_ID, SkipNav } from './skip-nav'

type MainNavLayoutProps = {
  children: ReactNode
  detailSidebar?: ReactNode
}

function AppDetailStoreCleanup() {
  const pathname = usePathname()
  const { hasAppDetail, setAppDetail } = useAppStore(
    useShallow((state) => ({
      hasAppDetail: !!state.appDetail,
      setAppDetail: state.setAppDetail,
    })),
  )

  useEffect(() => {
    if (pathname.startsWith('/app/') || !hasAppDetail) return

    setAppDetail()
  }, [hasAppDetail, pathname, setAppDetail])

  return null
}

const MainNavLayout = ({ children, detailSidebar }: MainNavLayoutProps) => {
  const { t } = useTranslation('common')
  const pathname = usePathname()
  const isCurrentWorkspaceDatasetOperator = useAtomValue(isCurrentWorkspaceDatasetOperatorAtom)
  const isCurrentWorkspaceEditor = useAtomValue(isCurrentWorkspaceEditorAtom)
  const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())
  const shouldHideMainNav = shouldUseDetailSidebar(pathname, {
    agentV2Enabled: isAgentV2Enabled(),
    canUseAppDeploy: isCurrentWorkspaceEditor && systemFeatures.enable_app_deploy,
    isCurrentWorkspaceDatasetOperator,
  })

  return (
    <div className="flex h-0 min-h-0 min-w-0 grow overflow-hidden bg-background-body">
      <SkipNav>{t(($) => $['navigation.skipToMain'])}</SkipNav>
      <AppDetailStoreCleanup />
      {shouldHideMainNav ? detailSidebar : <MainNav />}
      <main
        id={MAIN_CONTENT_ID}
        tabIndex={-1}
        className="flex min-h-0 min-w-0 grow flex-col overflow-hidden outline-hidden focus:outline-hidden focus-visible:outline-hidden"
      >
        {children}
      </main>
    </div>
  )
}

export default MainNavLayout
