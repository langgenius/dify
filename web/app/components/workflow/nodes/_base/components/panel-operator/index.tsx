import {
  memo,
  useCallback,
  useState,
} from 'react'
import { RiMoreFill } from '@remixicon/react'
import type { OffsetOptions } from '@floating-ui/react'
import PanelOperatorPopup from './panel-operator-popup'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import type { Node } from '@/app/components/workflow/types'

type PanelOperatorProps = {
  id: string
  data: Node['data']
  triggerClassName?: string
  offset?: OffsetOptions
  onOpenChange?: (open: boolean) => void
  inNode?: boolean
  showHelpLink?: boolean
}
const PanelOperator = ({
  id,
  data,
  triggerClassName,
  offset = {
    mainAxis: 4,
    crossAxis: 53,
  },
  onOpenChange,
  inNode,
  showHelpLink = true,
}: PanelOperatorProps) => {
  const [open, setOpen] = useState(false)

  const handleOpenChange = useCallback((newOpen: boolean) => {
    setOpen(newOpen)

    if (onOpenChange)
      onOpenChange(newOpen)
  }, [onOpenChange])

  return (
    <PortalToFollowElem
      placement='bottom-end'
      offset={offset}
      open={open}
      onOpenChange={handleOpenChange}
    >
      <PortalToFollowElemTrigger onClick={() => handleOpenChange(!open)}>
        <div
          className={`
            flex items-center justify-center w-6 h-6 rounded-md cursor-pointer
            hover:bg-black/5
            ${open && 'bg-black/5'}
            ${triggerClassName}
          `}
        >
          <RiMoreFill className={`w-4 h-4 ${inNode ? 'text-gray-500' : 'text-gray-700'}`} />
        </div>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className='z-[11]'>
        <PanelOperatorPopup
          id={id}
          data={data}
          onClosePopup={() => setOpen(false)}
          showHelpLink={showHelpLink}
        />
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}

export default memo(PanelOperator)
