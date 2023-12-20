import { useState } from 'react'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'

const ModelSelector = () => {
  const [open, setOpen] = useState(false)

  return (
    <PortalToFollowElem
      open={open}
      onOpenChange={setOpen}
      placement='bottom-start'
      offset={4}
    >
      <div className='relative'>
        <PortalToFollowElemTrigger
          onClick={() => setOpen(v => !v)}
        >
        </PortalToFollowElemTrigger>
        <PortalToFollowElemContent>
        </PortalToFollowElemContent>
      </div>
    </PortalToFollowElem>
  )
}

export default ModelSelector
