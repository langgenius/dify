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
            'mr-1 px-3 py-[7px] h-[32px] flex items-center rounded-lg border-[0.5px] border-transparent text-text-tertiary text-[13px] font-medium leading-[18px] cursor-pointer hover:bg-components-main-nav-nav-button-bg-active',
            value === option.value && 'bg-components-main-nav-nav-button-bg-active border-components-main-nav-nav-button-border shadow-xs text-components-main-nav-nav-button-text-active',
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
