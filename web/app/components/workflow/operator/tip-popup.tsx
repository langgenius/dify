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
      <TooltipContent sideOffset={4} className="flex max-w-none items-start gap-1">
        <span className="min-w-0 flex-1 px-0.5">{title}</span>
        {shortcut && <ShortcutKbd shortcut={shortcut} className="shrink-0" />}
      </TooltipContent>
    </Tooltip>
  )
}

export default memo(TipPopup)
