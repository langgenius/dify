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
          <div className='mr-1 w-16 h-1.5 rounded-[3px] border border-gray-400 overflow-hidden'>
            <div className='bg-gray-400 h-full' style={{ width: `${data * 100}%` }}></div>
          </div>
          {data}
        </div>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent style={{ zIndex: 1001 }}>
        <div className='p-3 bg-white text-xs font-medium text-gray-500 rounded-lg shadow-lg'>
          {t('common.chat.citation.hitScore')} {data}
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}

export default ProgressTooltip
