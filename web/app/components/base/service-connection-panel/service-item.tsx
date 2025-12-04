'use client'

import type { FC } from 'react'
import { memo } from 'react'
import { RiAddLine } from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import type { AuthType, ServiceConnectionItem } from './types'
import cn from '@/utils/classnames'

type ServiceItemProps = {
  service: ServiceConnectionItem
  onConnect: (serviceId: string, authType: AuthType) => void
}

const ServiceItem: FC<ServiceItemProps> = ({
  service,
  onConnect,
}) => {
  const { t } = useTranslation()

  const handleConnect = () => {
    onConnect(service.id, service.authType)
  }

  const getButtonText = () => {
    if (service.status === 'connected')
      return t('share.serviceConnection.connected')

    if (service.authType === 'api_key')
      return t('share.serviceConnection.addApiKey')

    return t('share.serviceConnection.connect')
  }

  const isConnected = service.status === 'connected'

  return (
    <div className={cn(
      'flex items-center justify-between gap-3 rounded-xl border border-components-panel-border-subtle bg-components-panel-bg px-4 py-3',
      'hover:border-components-panel-border hover:shadow-xs',
      'transition-all duration-200',
    )}>
      <div className="flex items-center gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center">
          {service.icon}
        </div>
        <div className="flex flex-col">
          <span className="system-sm-medium text-text-secondary">
            {service.name}
          </span>
          {service.description && (
            <span className="system-xs-regular text-text-tertiary">
              {service.description}
            </span>
          )}
        </div>
      </div>
      <Button
        variant={isConnected ? 'secondary' : 'secondary-accent'}
        size="small"
        onClick={handleConnect}
        disabled={isConnected}
      >
        {!isConnected && <RiAddLine className="mr-0.5 h-3.5 w-3.5" />}
        {getButtonText()}
      </Button>
    </div>
  )
}

export default memo(ServiceItem)
