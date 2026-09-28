import type { ReactElement } from 'react'
import type { WorkflowCanvasShortcutId } from '../shortcuts/definitions'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { memo } from 'react'
import { ShortcutKbd } from '../shortcuts/shortcut-kbd'

type TipPopupProps = {
  title: string
  children: ReactElement
  shortcut?: WorkflowCanvasShortcutId
}
const TipPopup = ({ title, children, shortcut }: TipPopupProps) => {
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipContent sideOffset={4} className="flex max-w-none items-center gap-1">
        <span className="px-0.5">{title}</span>
        {shortcut && <ShortcutKbd shortcut={shortcut} />}
      </TooltipContent>
    </Tooltip>
  )
}

export default memo(TipPopup)
