import type { FC } from 'react'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@langgenius/dify-ui/tooltip'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

type ProgressTooltipProps = {
  data: number
}

const ProgressTooltip: FC<ProgressTooltipProps> = ({
  data,
}) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  return (
    <Tooltip
      open={open}
      onOpenChange={setOpen}
    >
      <TooltipTrigger
        render={(
          <div
            data-testid="progress-trigger-content"
            className="flex grow items-center"
            onMouseEnter={() => setOpen(true)}
            onMouseLeave={() => setOpen(false)}
          />
        )}
      >
        <div className="mr-1 h-1.5 w-16 overflow-hidden rounded-[3px] border border-components-progress-gray-border">
          <div
            data-testid="progress-bar-fill"
            className="h-full bg-components-progress-gray-progress"
            style={{ width: `${data * 100}%` }}
          >
          </div>
        </div>
        {data}
      </TooltipTrigger>
      <TooltipContent
        data-testid="progress-tooltip-popup"
        placement="top-start"
        sideOffset={0}
        className="rounded-lg bg-components-tooltip-bg p-3 system-xs-medium text-text-quaternary shadow-lg"
      >
        {t('chat.citation.hitScore', { ns: 'common' })}
        {' '}
        {data}
      </TooltipContent>
    </Tooltip>
  )
}

export default ProgressTooltip
