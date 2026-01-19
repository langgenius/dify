import * as React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ApiAggregate } from '@/app/components/base/icons/src/vender/knowledge'
import { PortalToFollowElem, PortalToFollowElemContent, PortalToFollowElemTrigger } from '@/app/components/base/portal-to-follow-elem'
import Indicator from '@/app/components/header/indicator'
import { cn } from '@/utils/classnames'
import Card from './card'

type ApiAccessProps = {
  expand: boolean
  apiEnabled: boolean
}

const ApiAccess = ({
  expand,
  apiEnabled,
}: ApiAccessProps) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  const handleToggle = () => {
    setOpen(!open)
  }

  return (
    <div className="p-3 pt-2">
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
            'relative flex h-8 cursor-pointer items-center gap-2 rounded-lg border border-components-panel-border px-3',
            !expand && 'w-8 justify-center',
            open ? 'bg-state-base-hover' : 'hover:bg-state-base-hover',
          )}
          >
            <ApiAggregate className="size-4 shrink-0 text-text-secondary" />
            {expand && <div className="system-sm-medium grow text-text-secondary">{t('appMenus.apiAccess', { ns: 'common' })}</div>}
            <Indicator
              className={cn('shrink-0', !expand && 'absolute -right-px -top-px')}
              color={apiEnabled ? 'green' : 'yellow'}
            />
          </div>
        </PortalToFollowElemTrigger>
        <PortalToFollowElemContent className="z-[10]">
          <Card
            apiEnabled={apiEnabled}
          />
        </PortalToFollowElemContent>
      </PortalToFollowElem>
    </div>
  )
}

export default React.memo(ApiAccess)
