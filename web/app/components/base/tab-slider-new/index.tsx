import type { FC } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { SegmentedControl, SegmentedControlItem } from '@langgenius/dify-ui/segmented-control'

type Option = {
  value: string
  text: string
  icon?: React.ReactNode
}
type TabSliderProps = {
  ariaLabel: string
  className?: string
  value: string
  onChange: (v: string) => void
  options: Option[]
}
const TabSliderNew: FC<TabSliderProps> = ({ ariaLabel, className, value, onChange, options }) => {
  return (
    <SegmentedControl
      aria-label={ariaLabel}
      data-testid="tab-slider-new"
      value={value}
      onValueChange={(value) => onChange(value)}
      className={cn(className, 'relative flex gap-0 rounded-none bg-transparent p-0')}
    >
      {options.map((option) => (
        <SegmentedControlItem
          key={option.value}
          value={option.value}
          data-testid={`tab-item-${option.value}`}
          className="mr-1 h-8 justify-start gap-0 overflow-visible px-3 py-1.75 text-start text-[13px] leading-4.5 font-medium whitespace-normal text-text-tertiary transition-none hover:bg-state-base-hover hover:text-text-tertiary data-checked:border-components-main-nav-nav-button-border data-checked:bg-state-base-hover data-checked:text-components-main-nav-nav-button-text-active data-checked:shadow-xs"
        >
          {option.icon}
          {option.text}
        </SegmentedControlItem>
      ))}
    </SegmentedControl>
  )
}

export default TabSliderNew
