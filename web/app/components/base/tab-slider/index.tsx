import type { FC, ReactNode } from 'react'
import cn from '@/utils/classnames'

type Option = {
  value: string
  text: ReactNode
}
type TabSliderProps = {
  className?: string
  itemWidth?: number
  value: string
  onChange: (v: string) => void
  options: Option[]
}
const TabSlider: FC<TabSliderProps> = ({
  className,
  itemWidth = 118,
  value,
  onChange,
  options,
}) => {
  const currentIndex = options.findIndex(option => option.value === value)
  const current = options[currentIndex]

  return (
    <div className={cn('relative flex p-0.5 rounded-xl bg-components-segmented-control-bg-normal', className)}>
      {
        options.map(option => (
          <div
            key={option.value}
            className={'flex justify-center items-center h-[42px] rounded-xl cursor-pointer'}
            style={{
              width: itemWidth,
            }}
            onClick={() => onChange(option.value)}
          >
            {option.text}
          </div>
        ))
      }
      {
        current && (
          <div
            className={`
              absolute flex justify-center items-center h-[42px] rounded-xl cursor-pointer
              text-text-accent-light-mode-only bg-components-segmented-control-item-active-bg
              border-[0.5px] border-components-segmented-control-item-active-border shadow-xs transition-transform
            `}
            style={{
              width: itemWidth,
              transform: `translateX(${currentIndex * itemWidth}px)`,
            }}
          >
            {current.text}
          </div>
        )
      }
    </div>
  )
}

export default TabSlider
