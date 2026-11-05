'use client'

import type { TestCredentialState } from '@dify/contracts/api/console/apps/types.gen'
import type { ComponentProps } from 'react'
import { useTranslation } from 'react-i18next'
import ConnectionServiceItem from '@/app/components/share/connections/connection-service-item'
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
  const hasWarning =
    (!selectedId && showMissingConnectionWarning) ||
    (status && status !== 'connected' && (!!selectedId || showMissingConnectionWarning))

  return (
    <ConnectionServiceItem
      name={name}
      description={description}
      icon={icon}
      iconDark={iconDark}
      warning={
        hasWarning ? (
          <span role="status">
            {!selectedId || status === 'disconnected'
              ? t(($) => $['connections.setup.selectConnection'], { ns: 'share' })
              : status === 'reconnect_required'
                ? t(($) => $['connections.accounts.reconnectRequired'], { ns: 'share' })
                : t(($) => $['auth.unavailable'], { ns: 'plugin' })}
          </span>
        ) : undefined
      }
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
