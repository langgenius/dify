import { useState } from 'react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'

type ProgressTooltipProps = {
  data: number
}

const ProgressTooltip: FC<ProgressTooltipProps> = ({
  data,
}) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  return (
    <PortalToFollowElem
      open={open}
      onOpenChange={setOpen}
      placement='top-start'
    >
      <PortalToFollowElemTrigger
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
      >
        <div className='flex grow items-center'>
          <div className='mr-1 h-1.5 w-16 overflow-hidden rounded-[3px] border border-components-progress-gray-border'>
            <div className='h-full bg-components-progress-gray-progress' style={{ width: `${data * 100}%` }}></div>
          </div>
          {data}
        </div>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent style={{ zIndex: 1001 }}>
        <div className='system-xs-medium rounded-lg bg-components-tooltip-bg p-3 text-text-quaternary shadow-lg'>
          {t('common.chat.citation.hitScore')} {data}
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}

export default ProgressTooltip
