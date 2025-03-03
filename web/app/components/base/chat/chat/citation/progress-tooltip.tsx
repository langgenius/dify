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
        <div className='grow flex items-center'>
          <div className='mr-1 w-16 h-1.5 rounded-[3px] border border-components-progress-gray-border overflow-hidden'>
            <div className='bg-components-progress-gray-progress h-full' style={{ width: `${data * 100}%` }}></div>
          </div>
          {data}
        </div>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent style={{ zIndex: 1001 }}>
        <div className='p-3 bg-components-tooltip-bg system-xs-medium text-text-quaternary rounded-lg shadow-lg'>
          {t('common.chat.citation.hitScore')} {data}
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}

export default ProgressTooltip
