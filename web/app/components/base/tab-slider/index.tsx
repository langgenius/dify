import type { FC, ReactNode } from 'react'
import { useEffect, useState } from 'react'
import cn from '@/utils/classnames'
import Badge, { BadgeState } from '@/app/components/base/badge/index'
import { useInstalledPluginList } from '@/service/use-plugins'
type Option = {
  value: string
  text: ReactNode
}

type TabSliderProps = {
  className?: string
  value: string
  itemClassName?: string | ((active: boolean) => string)
  onChange: (v: string) => void
  options: Option[]
}

const TabSlider: FC<TabSliderProps> = ({
  className,
  itemClassName,
  value,
  onChange,
  options,
}) => {
  const [activeIndex, setActiveIndex] = useState(() => options.findIndex(option => option.value === value))
  const [sliderStyle, setSliderStyle] = useState({})
  const { data: pluginList } = useInstalledPluginList()

  const updateSliderStyle = (index: number) => {
    const tabElement = document.getElementById(`tab-${index}`)
    if (tabElement) {
      const { offsetLeft, offsetWidth } = tabElement
      setSliderStyle({
        transform: `translateX(${offsetLeft}px)`,
        width: `${offsetWidth}px`,
      })
    }
  }

  useEffect(() => {
    const newIndex = options.findIndex(option => option.value === value)
    setActiveIndex(newIndex)
    updateSliderStyle(newIndex)
  }, [value, options, pluginList?.total])

  return (
    <div className={cn(className, 'relative inline-flex items-center justify-center rounded-[10px] bg-components-segmented-control-bg-normal p-0.5')}>
      <div
        className="shadows-shadow-xs absolute bottom-0.5 left-0 right-0 top-0.5 rounded-[10px] bg-components-panel-bg transition-transform duration-300 ease-in-out"
        style={sliderStyle}
      />
      {options.map((option, index) => (
        <div
          id={`tab-${index}`}
          key={option.value}
          className={cn(
            'relative z-10 flex cursor-pointer items-center justify-center gap-1 rounded-[10px] px-2.5 py-1.5 transition-colors duration-300 ease-in-out',
            'system-md-semibold',
            index === activeIndex
              ? 'text-text-primary'
              : 'text-text-tertiary',
            typeof itemClassName === 'function' ? itemClassName(index === activeIndex) : itemClassName,
          )}
          onClick={() => {
            if (index !== activeIndex) {
              onChange(option.value)
              updateSliderStyle(index)
            }
          }}
        >
          {option.text}
          {/* if no plugin installed, the badge won't show */}
          {option.value === 'plugins'
            && (pluginList?.total ?? 0) > 0
            && <Badge
              size='s'
              uppercase={true}
              state={BadgeState.Default}
            >
              {pluginList?.total}
            </Badge>
          }
        </div>
      ))}
    </div>
  )
}

export default TabSlider
