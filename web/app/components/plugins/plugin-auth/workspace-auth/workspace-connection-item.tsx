'use client'

import type { TestCredentialState } from '@dify/contracts/api/console/apps/types.gen'
import type { ComponentProps } from 'react'
import { useTranslation } from 'react-i18next'
import ConnectionServiceItem from '@/app/components/share/connections/connection-service-item'
import { CredentialTypeEnum } from '../types'
import WorkspaceConnectionSelector from './workspace-connection-selector'

type Props = Omit<ComponentProps<typeof WorkspaceConnectionSelector>, 'providerName'> &
  Pick<
    ComponentProps<typeof ConnectionServiceItem>,
    'name' | 'description' | 'icon' | 'iconDark'
  > & {
    status?: TestCredentialState['status'] | null
    showMissingConnectionWarning?: boolean
  }

export default function WorkspaceConnectionItem({
  name,
  description,
  icon,
  iconDark,
  status,
  showMissingConnectionWarning = false,
  ...selectorProps
}: Props) {
  const { t } = useTranslation(['plugin', 'share'])
  const selectedId = selectorProps.credentialId
  const selectedCredential = selectorProps.authorization.credentials.find(
    (credential) => credential.id === selectedId,
  )
  const hasWarning =
    (!selectedId && showMissingConnectionWarning) ||
    (status !== undefined &&
      status !== 'connected' &&
      (!!selectedId || showMissingConnectionWarning))
  const getWarningMessage = () => {
    if (!selectedId || status === 'disconnected')
      return t(($) => $['connections.setup.selectConnection'], { ns: 'share' })
    if (status === null) return t(($) => $['connections.invalid'], { ns: 'share' })
    if (status === 'reconnect_required')
      return t(($) => $['connections.accounts.expired'], { ns: 'share' })
    if (status === 'invalid') {
      if (selectedCredential?.credential_type === CredentialTypeEnum.API_KEY)
        return t(($) => $['connections.apiKeys.warning'], { ns: 'share' })
      return t(($) => $['connections.accounts.reconnectRequired'], { ns: 'share' })
    }
    return t(($) => $['auth.unavailable'], { ns: 'plugin' })
  }

  return (
    <ConnectionServiceItem
      name={name}
      description={description}
      icon={icon}
      iconDark={iconDark}
      warning={hasWarning ? <span role="status">{getWarningMessage()}</span> : undefined}
      renderControls={() => (
        <WorkspaceConnectionSelector
          {...selectorProps}
          variant="inline"
          warning={!!hasWarning}
          providerName={name}
          placeholder={
            selectorProps.placeholder ??
            t(($) => $['connections.setup.selectConnection'], { ns: 'share' })
          }
        />
      )}
    />
  )
}
