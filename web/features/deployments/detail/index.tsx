'use client'

import type { ReactNode } from 'react'
import type { InstanceDetailTabKey } from './tabs'
import { useAtomValue } from 'jotai'
import { ScopeProvider } from 'jotai-scope'
import { useTranslation } from 'react-i18next'
import useDocumentTitle from '@/hooks/use-document-title'
import Link from '@/next/link'
import { useSelectedLayoutSegment } from '@/next/navigation'
import { CreateReleaseControl } from '../create-release'
import { deploymentRouteAppInstanceIdAtom } from '../route-state'
import { DeveloperApiHeaderSwitch } from './access-tab/developer-api/developer-api-header-switch'
import { NewDeploymentHeaderAction } from './deploy-tab/new-deployment-button'
import { INSTANCE_DETAIL_TAB_KEYS, isInstanceDetailTabKey } from './tabs'
import { versionsTabLocalAtoms } from './versions-tab/state'

function MobileDetailTabs({ appInstanceId, activeTab }: {
  appInstanceId: string
  activeTab: InstanceDetailTabKey
}) {
  const { t } = useTranslation('deployments')

  return (
    <nav
      aria-label={t('detail.mobileTabs')}
      className="border-b border-divider-subtle bg-components-panel-bg px-4 pc:hidden"
    >
      <div className="flex min-w-0 scrollbar-none gap-1 overflow-x-auto py-2">
        {INSTANCE_DETAIL_TAB_KEYS.map(tab => (
          <Link
            key={tab}
            href={`/deployments/${appInstanceId}/${tab}`}
            className={`inline-flex h-8 shrink-0 items-center rounded-lg px-3 system-sm-medium ${
              activeTab === tab
                ? 'bg-state-accent-hover text-text-accent'
                : 'text-text-tertiary hover:bg-state-base-hover hover:text-text-secondary'
            }`}
          >
            {t(`tabs.${tab}.name`)}
          </Link>
        ))}
      </div>
    </nav>
  )
}

export function InstanceDetail({ children }: {
  children: ReactNode
}) {
  const { t } = useTranslation('deployments')
  const appInstanceId = useAtomValue(deploymentRouteAppInstanceIdAtom)
  const selectedSegment = useSelectedLayoutSegment()
  const selectedTab = selectedSegment ?? undefined
  const activeTab: InstanceDetailTabKey = isInstanceDetailTabKey(selectedTab) ? selectedTab : 'overview'

  useDocumentTitle(t('documentTitle.detail'))

  if (!appInstanceId)
    return null

  return (
    <ScopeProvider
      key={appInstanceId}
      atoms={[
        ...versionsTabLocalAtoms,
      ]}
      name="DeploymentDetail"
    >
      <div className="relative m-1 ml-0 flex min-h-0 flex-1 overflow-hidden rounded-lg shadow-xs">
        <div className="min-w-0 grow overflow-hidden bg-components-panel-bg">
          <div className="h-full min-w-0 overflow-y-auto">
            <div className="flex min-h-full w-full flex-col">
              <div className="flex w-full flex-col gap-y-0.5 px-4 pt-3 pb-2 sm:px-6">
                <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                  <div className="min-w-0">
                    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
                      <div className="system-xl-semibold text-text-primary">{t(`tabs.${activeTab}.name`)}</div>
                      {activeTab === 'api-tokens' && (
                        <div className="shrink-0">
                          <DeveloperApiHeaderSwitch />
                        </div>
                      )}
                    </div>
                    <div className="system-sm-regular text-text-tertiary">{t(`tabs.${activeTab}.description`)}</div>
                  </div>
                  {(activeTab === 'instances' || activeTab === 'releases') && (
                    <div className="w-full shrink-0 pt-1 sm:w-auto sm:pt-1.5 [&_button]:w-full sm:[&_button]:w-auto">
                      {activeTab === 'instances'
                        ? <NewDeploymentHeaderAction />
                        : <CreateReleaseControl appInstanceId={appInstanceId} size="medium" />}
                    </div>
                  )}
                </div>
              </div>
              <MobileDetailTabs appInstanceId={appInstanceId} activeTab={activeTab} />
              {children}
            </div>
          </div>
        </div>
      </div>
    </ScopeProvider>
  )
}
