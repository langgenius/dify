'use client'

import type { AccessPointAppInfo } from './utils'
import { Button } from '@langgenius/dify-ui/button'
import { useTranslation } from 'react-i18next'
import { useDocLink } from '@/context/i18n'
import Link from '@/next/link'
import { AccessPointCard } from './access-point-card'
import { AccessPointUrl } from './access-point-url'
import { ApiSecretKeyButton } from './api-secret-key-button'
import { getAppApiReferencePath, getBuiltInAccessUrls } from './utils'

type ServiceApiAccessPointCardProps = {
  appInfo: AccessPointAppInfo
  availability: 'available' | 'loading' | 'unavailable'
  canEdit: boolean
  highlighted?: boolean
  onChangeStatus: (enabled: boolean) => Promise<void>
}

export function ServiceApiAccessPointCard({
  appInfo,
  availability,
  canEdit,
  highlighted,
  onChangeStatus,
}: ServiceApiAccessPointCardProps) {
  const { t } = useTranslation()
  const docLink = useDocLink()
  const { api: apiUrl } = getBuiltInAccessUrls(appInfo)
  const apiReferencePath = getAppApiReferencePath(appInfo.mode)
  const apiReferenceUrl = apiReferencePath ? docLink(apiReferencePath) : undefined
  const running = availability === 'available' && appInfo.enable_api
  const status = availability !== 'available' ? 'unavailable' : running ? 'inService' : 'disabled'
  const statusLabel =
    availability !== 'available'
      ? t(($) => $['health.ENVIRONMENT_STATUS_FAILED'], { ns: 'deployments' })
      : running
        ? t(($) => $['agentDetail.access.status.inService'], { ns: 'agentV2' })
        : t(($) => $['overview.status.disable'], { ns: 'appOverview' })

  return (
    <AccessPointCard
      title={t(($) => $['agentDetail.access.serviceApi.title'], { ns: 'agentV2' })}
      description={t(($) => $['studio.accessPoint.apiDescription'], {
        ns: 'deployments',
      })}
      icon="i-custom-vender-knowledge-api-aggregate"
      status={status}
      statusLabel={statusLabel}
      highlighted={highlighted}
      switchDisabled={!canEdit}
      switchLabel={t(($) => $['overview.apiInfo.title'], { ns: 'appOverview' })}
      onEnabledChange={availability === 'available' ? onChangeStatus : undefined}
      actions={
        <>
          <ApiSecretKeyButton appId={appInfo.id} canManage={canEdit} disabled={!running} />
          <Button
            variant="secondary"
            disabled={availability !== 'available' || !apiReferenceUrl}
            nativeButton={false}
            render={
              apiReferenceUrl ? (
                <Link href={apiReferenceUrl} target="_blank" rel="noopener noreferrer" />
              ) : (
                <span />
              )
            }
            className="flex items-center gap-1"
          >
            <span aria-hidden className="i-ri-book-open-line size-4" />
            {t(($) => $['overview.apiInfo.doc'], { ns: 'appOverview' })}
            <span aria-hidden className="i-ri-arrow-right-up-line size-3.5" />
          </Button>
        </>
      }
    >
      <AccessPointUrl
        label={t(($) => $['overview.apiInfo.accessibleAddress'], {
          ns: 'appOverview',
        })}
        value={apiUrl}
        enabled={running}
        loading={availability === 'loading'}
        unavailable={availability === 'unavailable'}
        unavailableLabel={t(($) => $['health.ENVIRONMENT_STATUS_FAILED'], {
          ns: 'deployments',
        })}
      />
    </AccessPointCard>
  )
}
