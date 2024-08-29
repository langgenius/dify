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
      className='mb-1 p-3 border-t-[0.5px] border-l-[0.5px] border-effects-highlight rounded-xl bg-background-section-burn'
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className='mb-2 flex items-center gap-2'>
        {icon}
        <div className='grow flex items-center text-text-secondary system-sm-semibold'>
          {title}
          {tooltip && (
            <Tooltip
              popupContent={tooltip}
            >
              <div className='ml-0.5 p-px'><RiQuestionLine className='w-3.5 h-3.5 text-text-quaternary' /></div>
            </Tooltip>
          )}
        </div>
        <Switch disabled={disabled} className='shrink-0' onChange={state => onChange?.(state)} defaultValue={value} />
      </div>
      {description && (
        <div className='min-h-8 text-text-tertiary system-xs-regular line-clamp-2'>{description}</div>
      )}
      {children}
    </div>
  )
}

export default FeatureCard
