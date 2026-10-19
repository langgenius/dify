'use client'

import type { ButtonProps } from '@langgenius/dify-ui/button'
import type { RequiredConnectionService } from './required-services'
import { Button } from '@langgenius/dify-ui/button'
import { useTranslation } from 'react-i18next'
import Badge from '@/app/components/base/badge'

type Props = Omit<ButtonProps, 'children' | 'variant'> & {
  services: readonly RequiredConnectionService[]
}

export default function ConfigureConnectionsButton({ services, ...props }: Props) {
  const { t } = useTranslation(['share'])
  const warningCount = services.filter((service) => {
    const selectedConnection = service.availableConnections.find(
      (connection) => connection.id === service.selectedConnectionId,
    )
    return selectedConnection?.status === 'expired' || selectedConnection?.status === 'invalid'
  }).length

  return (
    <Button variant="ghost" {...props}>
      <span className="i-ri-link size-4" aria-hidden="true" />
      {t(($) => $['connections.configure.title'], { ns: 'share' })}
      {warningCount > 0 && (
        <Badge as="span" size="xs" variant="dimm" className="border-text-warning text-text-warning">
          {warningCount}
        </Badge>
      )}
    </Button>
  )
}
