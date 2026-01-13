import type { OffsetOptions } from '@floating-ui/react'
import type { Node } from '@/app/components/workflow/types'
import { RiMoreFill } from '@remixicon/react'
import {
  memo,
  useCallback,
  useState,
} from 'react'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import PanelOperatorPopup from './panel-operator-popup'

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
      placement="bottom-end"
      offset={offset}
      open={open}
      onOpenChange={handleOpenChange}
    >
      <PortalToFollowElemTrigger onClick={() => handleOpenChange(!open)}>
        <div
          className={`
            flex h-6 w-6 cursor-pointer items-center justify-center rounded-md
            hover:bg-state-base-hover
            ${open && 'bg-state-base-hover'}
            ${triggerClassName}
          `}
        >
          <RiMoreFill className="h-4 w-4 text-text-tertiary" />
        </div>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className="z-[11]">
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
