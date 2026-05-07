import { Switch } from '@langgenius/dify-ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import {
  RiQuestionLine,
} from '@remixicon/react'
import * as React from 'react'

type Props = {
  icon: any
  title: any
  tooltip?: any
  value: any
  description?: string
  children?: React.ReactNode
  disabled?: boolean
  onChange?: (state: any) => void
  onMouseEnter?: () => void
  onMouseLeave?: () => void
}

const FeatureCard = ({
  icon,
  title,
  tooltip,
  value,
  description,
  children,
  disabled,
  onChange,
  onMouseEnter,
  onMouseLeave,
}: Props) => {
  return (
    <div
      className="mb-1 rounded-xl border-t-[0.5px] border-l-[0.5px] border-effects-highlight bg-background-section-burn p-3"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className="mb-2 flex items-center gap-2">
        {icon}
        <div className="flex grow items-center system-sm-semibold text-text-secondary">
          {title}
          {tooltip && (
            <Tooltip>
              <TooltipTrigger
                render={(
                  <div className="ml-0.5 p-px"><RiQuestionLine className="h-3.5 w-3.5 text-text-quaternary" /></div>
                )}
              />
              <TooltipContent>
                {tooltip}
              </TooltipContent>
            </Tooltip>
          )}
        </div>
        <Switch disabled={disabled} className="shrink-0" onCheckedChange={state => onChange?.(state)} checked={value} />
      </div>
      {description && (
        <div className="line-clamp-2 min-h-8 system-xs-regular text-text-tertiary">{description}</div>
      )}
      {children}
    </div>
  )
}

export default FeatureCard
