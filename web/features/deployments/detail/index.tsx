'use client'

import type { ReactNode } from 'react'
import type { InstanceDetailTabKey } from './tabs'
import { useTranslation } from 'react-i18next'
import useDocumentTitle from '@/hooks/use-document-title'
import Link from '@/next/link'
import { useSelectedLayoutSegment } from '@/next/navigation'
import { DeployDrawer } from '../components/deploy-drawer'
import { NewDeploymentButton } from './deploy-tab'
import { DeploymentSidebar } from './deployment-sidebar'
import { DeveloperApiHeaderActions, DeveloperApiHeaderSwitch } from './settings-tab/access/developer-api-section'
import { INSTANCE_DETAIL_TAB_KEYS, isInstanceDetailTabKey } from './tabs'
import { CreateReleaseControl } from './versions-tab/create-release-control'

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
      <div className="relative flex h-full min-w-0 overflow-hidden rounded-t-2xl shadow-xs">
        <DeploymentSidebar appInstanceId={appInstanceId} />
        <div className="min-w-0 grow overflow-hidden bg-components-panel-bg">
          <div className="h-full min-w-0 overflow-y-auto">
            <div className="mx-auto flex min-h-full w-full max-w-[1120px] flex-col">
              <div className="flex w-full flex-col gap-y-0.5 px-4 pt-3 pb-2 sm:px-6">
                <div className="flex min-w-0 items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
                      <div className="system-xl-semibold text-text-primary">{t(`tabs.${activeTab}.name`)}</div>
                      {activeTab === 'api-tokens' && (
                        <div className="shrink-0">
                          <DeveloperApiHeaderSwitch appInstanceId={appInstanceId} />
                        </div>
                      )}
                    </div>
                    <div className="system-sm-regular text-text-tertiary">{t(`tabs.${activeTab}.description`)}</div>
                  </div>
                  {(activeTab === 'api-tokens' || activeTab === 'releases' || activeTab === 'instances') && (
                    <div className="shrink-0 pt-1.5">
                      {activeTab === 'api-tokens'
                        ? <DeveloperApiHeaderActions appInstanceId={appInstanceId} />
                        : activeTab === 'instances'
                          ? <NewDeploymentButton appInstanceId={appInstanceId} />
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
      <DeployDrawer />
    </>
  )
}
