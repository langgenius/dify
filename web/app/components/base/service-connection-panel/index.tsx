'use client'

import type { FC } from 'react'
import { memo, useMemo } from 'react'
import { RiArrowRightLine } from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import ServiceItem from './service-item'
import type { ServiceConnectionPanelProps } from './types'
import cn from '@/utils/classnames'

const ServiceConnectionPanel: FC<ServiceConnectionPanelProps> = ({
  title,
  description,
  services,
  onConnect,
  onContinue,
  continueDisabled,
  continueText,
  className,
}) => {
  const { t } = useTranslation()

  const allConnected = useMemo(() => {
    return services.every(service => service.status === 'connected')
  }, [services])

  const displayTitle = title || t('share.serviceConnection.title')
  const displayDescription = description || t('share.serviceConnection.description', { count: services.length })

  return (
    <div className={cn(
      'flex w-full max-w-[600px] flex-col items-center',
      className,
    )}>
      <div className="mb-6 text-center">
        <h2 className="system-xl-semibold mb-1 text-text-primary">
          {displayTitle}
        </h2>
        <p className="system-sm-regular text-text-tertiary">
          {displayDescription}
        </p>
      </div>

      <div className="w-full space-y-2">
        {services.map(service => (
          <ServiceItem
            key={service.id}
            service={service}
            onConnect={onConnect}
          />
        ))}
      </div>

      {onContinue && (
        <div className="mt-6 flex w-full justify-end">
          <Button
            variant="primary"
            disabled={continueDisabled ?? !allConnected}
            onClick={onContinue}
          >
            {continueText || t('share.serviceConnection.continue')}
            <RiArrowRightLine className="ml-1 h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  )
}

export default memo(ServiceConnectionPanel)

export { default as ServiceItem } from './service-item'
export type {
  ServiceConnectionPanelProps,
  ServiceConnectionItem,
  AuthType,
  ServiceConnectionStatus,
} from './types'
