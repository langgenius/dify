import * as React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PortalToFollowElem, PortalToFollowElemContent, PortalToFollowElemTrigger } from '@/app/components/base/portal-to-follow-elem'
import Indicator from '@/app/components/header/indicator'
import { cn } from '@/utils/classnames'
import Card from './card'

type ServiceApiProps = {
  apiBaseUrl: string
}

const ServiceApi = ({
  apiBaseUrl,
}: ServiceApiProps) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  const handleToggle = () => {
    setOpen(!open)
  }

  return (
    <div>
      <PortalToFollowElem
        open={open}
        onOpenChange={setOpen}
        placement="top-start"
        offset={{
          mainAxis: 4,
          crossAxis: -4,
        }}
      >
        <PortalToFollowElemTrigger
          className="w-full"
          onClick={handleToggle}
        >
          <div className={cn(
            'relative flex h-8 cursor-pointer items-center gap-2 rounded-lg border-[0.5px] border-components-button-secondary-border-hover bg-components-button-secondary-bg px-3',
            open ? 'bg-components-button-secondary-bg-hover' : 'hover:bg-components-button-secondary-bg-hover',
          )}
          >
            <Indicator
              className={cn('shrink-0')}
              color={
                apiBaseUrl ? 'green' : 'yellow'
              }
            />
            <div className="system-sm-medium grow text-text-secondary">{t('serviceApi.title', { ns: 'dataset' })}</div>
          </div>
        </PortalToFollowElemTrigger>
        <PortalToFollowElemContent className="z-[10]">
          <Card
            apiBaseUrl={apiBaseUrl}
          />
        </PortalToFollowElemContent>
      </PortalToFollowElem>
    </div>
  )
}

export default React.memo(ServiceApi)
