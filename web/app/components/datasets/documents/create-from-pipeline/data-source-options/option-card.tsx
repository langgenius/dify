import React from 'react'
import cn from '@/utils/classnames'

type OptionCardProps = {
  label: string
  Icon: React.FC<React.SVGProps<SVGSVGElement>> | string
  selected: boolean
  onClick?: () => void
}

const OptionCard = ({
  label,
  Icon,
  selected,
  onClick,
}: OptionCardProps) => {
  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-xl border border-components-option-card-option-border bg-components-option-card-option-bg p-3 shadow-shadow-shadow-3',
        selected
          ? 'border-components-option-card-option-selected-border bg-components-option-card-option-selected-bg shadow-xs ring-[0.5px] ring-inset ring-components-option-card-option-selected-border'
          : 'hover:bg-components-option-card-bg-hover hover:border-components-option-card-option-border-hover hover:shadow-xs',
      )}
      onClick={onClick}
    >
      <div className='flex size-8 items-center justify-center rounded-lg border-[0.5px] border-components-panel-border bg-background-default-dodge p-1.5'>
        {
          typeof Icon === 'string'
            ? <div className='text-[18px] leading-[18px]'>{Icon}</div>
            : <Icon className='size-5' />
        }
      </div>
      <div className={cn('system-sm-medium text-text-secondary', selected && 'text-primary')}>
        {label}
      </div>
    </div>
  )
}

export default React.memo(OptionCard)
