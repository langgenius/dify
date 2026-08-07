'use client'

import type { ComponentProps } from 'react'
import type { AccessPointStatus } from './access-point-status'
import type { AppModeEnum } from '@/types/app'
import { Button } from '@langgenius/dify-ui/button'
import { useTranslation } from 'react-i18next'
import { useDocLink } from '@/context/i18n'
import Link from '@/next/link'
import { AccessPointCard } from './access-point-card'
import { AccessPointUrl } from './access-point-url'
import { ApiSecretKeyButton } from './api-secret-key-button'
import { getAppApiReferencePath } from './utils'

type ServiceApiCardViewProps = {
  apiKeyButtonProps: ComponentProps<typeof ApiSecretKeyButton>
  apiUrl: string
  appMode?: AppModeEnum
  available: boolean
  status: AccessPointStatus
  switchDisabled: boolean
  busy?: boolean
  highlighted?: boolean
  onEnabledChange?: (enabled: boolean) => void
}

export function ServiceApiCardView({
  apiKeyButtonProps,
  apiUrl,
  appMode,
  available,
  busy = false,
  highlighted,
  onEnabledChange,
  status,
  switchDisabled,
}: ServiceApiCardViewProps) {
  const { t } = useTranslation()
  const docLink = useDocLink()
  const apiReferencePath = appMode ? getAppApiReferencePath(appMode) : undefined
  const apiReferenceUrl = apiReferencePath ? docLink(apiReferencePath) : undefined

  return (
    <AccessPointCard
      title={t(($) => $['agentDetail.access.serviceApi.title'], { ns: 'agentV2' })}
      description={t(($) => $['studio.accessPoint.apiDescription'], {
        ns: 'deployments',
      })}
      icon="i-custom-vender-knowledge-api-aggregate"
      status={status}
      highlighted={highlighted}
      switchDisabled={switchDisabled}
      switchLabel={t(($) => $['overview.apiInfo.title'], { ns: 'appOverview' })}
      onEnabledChange={onEnabledChange}
      busy={busy}
      actions={
        <>
          <ApiSecretKeyButton {...apiKeyButtonProps} />
          <Button
            variant="secondary"
            disabled={!available || !apiReferenceUrl}
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
        enabled={status === 'inService'}
        loading={status === 'loading'}
        unavailable={status === 'unavailable'}
        unavailableLabel={t(($) => $['health.ENVIRONMENT_STATUS_FAILED'], {
          ns: 'deployments',
        })}
      />
    </AccessPointCard>
  )
}
