import type { OffsetOptions } from '@floating-ui/react'
import type { Node } from '@/app/components/workflow/types'
import {
  memo,
  useCallback,
  useState,
} from 'react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/app/components/base/ui/dropdown-menu'
import PanelOperatorPopup from './panel-operator-popup'

type PanelOperatorProps = {
  id: string
  data: Node['data']
  triggerClassName?: string
  offset?: OffsetOptions | number
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
  const sideOffset = typeof offset === 'number'
    ? offset
    : typeof offset === 'object' && offset && 'mainAxis' in offset && typeof offset.mainAxis === 'number'
      ? offset.mainAxis
      : 4
  const alignOffset = typeof offset === 'object' && offset && 'crossAxis' in offset && typeof offset.crossAxis === 'number'
    ? offset.crossAxis
    : 0

  const handleOpenChange = useCallback((newOpen: boolean) => {
    setOpen(newOpen)

    if (onOpenChange)
      onOpenChange(newOpen)
  }, [onOpenChange])

  return (
    <DropdownMenu
      open={open}
      onOpenChange={handleOpenChange}
    >
      <DropdownMenuTrigger render={<div />}>
        <div
          className={`
            flex h-6 w-6 cursor-pointer items-center justify-center rounded-md
            hover:bg-state-base-hover
            ${open && 'bg-state-base-hover'}
            ${triggerClassName}
          `}
        >
          <span aria-hidden className="i-ri-more-fill h-4 w-4 text-text-tertiary" />
        </div>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        placement="bottom-end"
        sideOffset={sideOffset}
        alignOffset={alignOffset}
        popupClassName="border-0 bg-transparent p-0 shadow-none backdrop-blur-none"
      >
        <PanelOperatorPopup
          id={id}
          data={data}
          onClosePopup={() => handleOpenChange(false)}
          showHelpLink={showHelpLink}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export default memo(PanelOperator)
