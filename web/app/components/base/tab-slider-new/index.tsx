import type { FC } from 'react'
import cn from '@/utils/classnames'

type Option = {
  value: string
  text: string
  icon?: React.ReactNode
}
type TabSliderProps = {
  className?: string
  value: string
  onChange: (v: string) => void
  options: Option[]
}
const TabSliderNew: FC<TabSliderProps> = ({
  className,
  value,
  onChange,
  options,
}) => {
  return (
    <div className={cn(className, 'relative flex')}>
      {options.map(option => (
        <div
          key={option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            'mr-1 flex h-[32px] cursor-pointer items-center rounded-lg border-[0.5px] border-transparent px-3 py-[7px] text-[13px] font-medium leading-[18px] text-text-tertiary hover:bg-state-base-hover',
            value === option.value && 'border-components-main-nav-nav-button-border bg-state-base-hover text-components-main-nav-nav-button-text-active shadow-xs',
          )}
        >
          {option.icon}
          {option.text}
        </div>
      ))}
    </div>
  )
}

export default TabSliderNew
