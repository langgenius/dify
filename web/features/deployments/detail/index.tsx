'use client'

import type { ReactNode } from 'react'
import type { InstanceDetailTabKey } from './tabs'
import { useTranslation } from 'react-i18next'
import useDocumentTitle from '@/hooks/use-document-title'
import { useSelectedLayoutSegment } from '@/next/navigation'
import { DeployDrawer } from '../components/deploy-drawer'
import { DeploymentSidebar } from './deployment-sidebar'
import { isInstanceDetailTabKey } from './tabs'

export function InstanceDetail({ appInstanceId, children }: {
  appInstanceId: string
  children: ReactNode
}) {
  const { t } = useTranslation('deployments')
  const selectedSegment = useSelectedLayoutSegment()
  const selectedTab = selectedSegment ?? undefined
  const activeTab: InstanceDetailTabKey = isInstanceDetailTabKey(selectedTab) ? selectedTab : 'overview'

  useDocumentTitle(t('documentTitle.detail'))

  return (
    <>
      <div className="relative flex h-full overflow-hidden rounded-t-2xl shadow-xs">
        <DeploymentSidebar appInstanceId={appInstanceId} />
        <div className="grow overflow-hidden bg-components-panel-bg">
          <div className="h-full overflow-y-auto">
            <div className="flex flex-col gap-y-0.5 px-6 pt-3 pb-2">
              <div className="system-xl-semibold text-text-primary">{t(`tabs.${activeTab}.name`)}</div>
              <div className="system-sm-regular text-text-tertiary">{t(`tabs.${activeTab}.description`)}</div>
            </div>
            {children}
          </div>
        </div>
      </div>
      <DeployDrawer />
    </>
  )
}
