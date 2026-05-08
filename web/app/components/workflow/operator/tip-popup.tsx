import type { ReactElement } from 'react'
import type { WorkflowShortcutId } from '../shortcuts/definitions'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@langgenius/dify-ui/tooltip'
import { memo } from 'react'
import { ShortcutKbd } from '../shortcuts/shortcut-kbd'

type TipPopupProps = {
  title: string
  children: ReactElement
  shortcut?: WorkflowShortcutId
}
const TipPopup = ({
  title,
  children,
  shortcut,
}: TipPopupProps) => {
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipContent
        sideOffset={4}
        className="max-w-none bg-transparent p-0 shadow-none"
      >
        <div className="flex items-center gap-1 rounded-lg border-[0.5px] border-components-panel-border bg-components-tooltip-bg p-1.5 shadow-lg backdrop-blur-[5px]">
          <span className="system-xs-medium text-text-secondary">{title}</span>
          {
            shortcut && <ShortcutKbd shortcut={shortcut} />
          }
        </div>
      </TooltipContent>
    </Tooltip>
  )
}

export default memo(TipPopup)
