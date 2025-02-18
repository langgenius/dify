'use client'
import type { FC } from 'react'
import { memo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RiSettings2Line } from '@remixicon/react'
import ParamConfigContent from './param-config-content'
import Button from '@/app/components/base/button'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import cn from '@/utils/classnames'

const ParamsConfig: FC = () => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  return (
    <PortalToFollowElem
      open={open}
      onOpenChange={setOpen}
      placement='bottom-end'
      offset={{
        mainAxis: 4,
      }}
    >
      <PortalToFollowElemTrigger onClick={() => setOpen(v => !v)}>
        <Button variant='ghost' size='small' className={cn('')}>
          <RiSettings2Line className='h-3.5 w-3.5' />
          <div className='ml-1'>{t('appDebug.voice.settings')}</div>
        </Button>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent style={{ zIndex: 50 }}>
        <div className='bg-components-panel-bg border-components-panel-border w-80 space-y-3 rounded-lg border-[0.5px] p-4 shadow-lg sm:w-[412px]'>
          <ParamConfigContent />
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}
export default memo(ParamsConfig)
