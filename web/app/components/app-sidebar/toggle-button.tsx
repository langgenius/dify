import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { RiArrowLeftSLine, RiArrowRightSLine } from '@remixicon/react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import ShortcutsName from '../workflow/shortcuts-name'

type ToggleTooltipContentProps = {
  expand: boolean
}

const TOGGLE_SHORTCUT = ['ctrl', 'B']

const ToggleTooltipContent = ({
  expand,
}: ToggleTooltipContentProps) => {
  const { t } = useTranslation()

  return (
    <div className="flex items-center gap-x-1">
      <span className="px-0.5 system-xs-medium text-text-secondary">{expand ? t('sidebar.collapseSidebar', { ns: 'layout' }) : t('sidebar.expandSidebar', { ns: 'layout' })}</span>
      <ShortcutsName keys={TOGGLE_SHORTCUT} textColor="secondary" />
    </div>
  )
}

type ToggleButtonProps = {
  expand: boolean
  handleToggle: () => void
  className?: string
}

const ToggleButton = ({
  expand,
  handleToggle,
  className,
}: ToggleButtonProps) => {
  return (
    <Tooltip>
      <TooltipTrigger
        render={(
          <Button
            size="small"
            onClick={handleToggle}
            className={cn('rounded-full px-1', className)}
          />
        )}
      >
        {expand ? <RiArrowLeftSLine className="size-4" /> : <RiArrowRightSLine className="size-4" />}
      </TooltipTrigger>
      <TooltipContent placement="right" className="rounded-lg p-1.5">
        <ToggleTooltipContent expand={expand} />
      </TooltipContent>
    </Tooltip>
  )
}

export default React.memo(ToggleButton)
