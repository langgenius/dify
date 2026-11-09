'use client'

import type { ReactNode } from 'react'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { useQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { consoleQuery } from '@/service/console'
import { hasPermission } from '@/utils/permission'
import ExternalAPIPanel from '../external-api/external-api-panel'
import { ServiceApi } from '../extra-info/service-api'

type Props = {
  apiReferenceUrl?: string
  className?: string
  viewSwitcher?: ReactNode
}

export function KnowledgeListTitleBar({ apiReferenceUrl, className, viewSwitcher }: Props) {
  const { t } = useTranslation(['dataset'])
  const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)
  const canConnectExternalDataset = hasPermission(
    workspacePermissionKeys,
    'dataset.external.connect',
  )
  const { data: apiBaseInfo } = useQuery(consoleQuery.datasets.apiBaseInfo.get.queryOptions())
  const [showExternalApiPanel, setShowExternalApiPanel] = useState(false)

  return (
    <div className={cn('shrink-0 bg-background-body pt-4', className)}>
      <div className="flex min-h-6 w-full flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h1 className="min-w-0 text-[18px]/[21.6px] font-semibold text-text-primary">
            {t(($) => $.knowledge, { ns: 'dataset' })}
          </h1>
          {viewSwitcher}
        </div>
        <div className="flex max-w-full shrink-0 flex-wrap items-center gap-2">
          {canConnectExternalDataset && (
            <Button
              variant="ghost"
              size="small"
              className="overflow-hidden text-text-tertiary"
              onClick={() => setShowExternalApiPanel(true)}
            >
              <span
                aria-hidden
                className="i-custom-vender-solid-development-api-connection-mod size-3.5 shrink-0"
              />
              <span className="system-xs-medium">
                {t(($) => $.externalAPIPanelTitle, { ns: 'dataset' })}
              </span>
            </Button>
          )}
          <ServiceApi
            apiBaseUrl={apiBaseInfo?.api_base_url ?? ''}
            apiReferenceUrl={apiReferenceUrl}
          />
        </div>
      </div>
      {showExternalApiPanel && canConnectExternalDataset && (
        <ExternalAPIPanel
          canManageExternalKnowledgeApi={canConnectExternalDataset}
          onClose={() => setShowExternalApiPanel(false)}
        />
      )}
    </div>
  )
}
