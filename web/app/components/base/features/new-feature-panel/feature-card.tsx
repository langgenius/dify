import React from 'react'
import {
  RiQuestionLine,
} from '@remixicon/react'
import Switch from '@/app/components/base/switch'
import Tooltip from '@/app/components/base/tooltip'

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
      className='mb-1 rounded-xl border-l-[0.5px] border-t-[0.5px] border-effects-highlight bg-background-section-burn p-3'
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className='mb-2 flex items-center gap-2'>
        {icon}
        <div className='system-sm-semibold flex grow items-center text-text-secondary'>
          {title}
          {tooltip && (
            <Tooltip
              popupContent={tooltip}
            >
              <div className='ml-0.5 p-px'><RiQuestionLine className='h-3.5 w-3.5 text-text-quaternary' /></div>
            </Tooltip>
          )}
        </div>
        <Switch disabled={disabled} className='shrink-0' onChange={state => onChange?.(state)} defaultValue={value} />
      </div>
      {description && (
        <div className='system-xs-regular line-clamp-2 min-h-8 text-text-tertiary'>{description}</div>
      )}
      {children}
    </div>
  )
}

export default FeatureCard
