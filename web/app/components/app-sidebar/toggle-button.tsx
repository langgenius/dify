import { RiArrowLeftSLine, RiArrowRightSLine } from '@remixicon/react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/utils/classnames'
import Button from '../base/button'
import Tooltip from '../base/tooltip'
import { getKeyboardKeyNameBySystem } from '../workflow/utils'

type TooltipContentProps = {
  expand: boolean
}

const TOGGLE_SHORTCUT = ['ctrl', 'B']

const TooltipContent = ({
  expand,
}: TooltipContentProps) => {
  const { t } = useTranslation()

  return (
    <div className="flex items-center gap-x-1">
      <span className="system-xs-medium px-0.5 text-text-secondary">{expand ? t('sidebar.collapseSidebar', { ns: 'layout' }) : t('sidebar.expandSidebar', { ns: 'layout' })}</span>
      <div className="flex items-center gap-x-0.5">
        {
          TOGGLE_SHORTCUT.map(key => (
            <span
              key={key}
              className="system-kbd inline-flex items-center justify-center rounded-[4px] bg-components-kbd-bg-gray px-1 text-text-tertiary"
            >
              {getKeyboardKeyNameBySystem(key)}
            </span>
          ))
        }
      </div>
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
    <Tooltip
      popupContent={<TooltipContent expand={expand} />}
      popupClassName="p-1.5 rounded-lg"
      position="right"
    >
      <Button
        size="small"
        onClick={handleToggle}
        className={cn('rounded-full px-1', className)}
      >
        {
          expand
            ? <RiArrowLeftSLine className="size-4" />
            : <RiArrowRightSLine className="size-4" />
        }
      </Button>
    </Tooltip>
  )
}

export default React.memo(ToggleButton)
