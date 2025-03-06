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
  onChange: (v: string) => void
  options: Option[]
}

const TabSlider: FC<TabSliderProps> = ({
  className,
  value,
  onChange,
  options,
}) => {
  const [activeIndex, setActiveIndex] = useState(options.findIndex(option => option.value === value))
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
  }, [value, options, pluginList])

  return (
    <div className={cn(className, 'inline-flex p-0.5 rounded-[10px] bg-components-segmented-control-bg-normal relative items-center justify-center')}>
      <div
        className="absolute top-0.5 bottom-0.5 left-0 right-0 bg-components-panel-bg rounded-[10px] transition-transform duration-300 ease-in-out shadows-shadow-xs"
        style={sliderStyle}
      />
      {options.map((option, index) => (
        <div
          id={`tab-${index}`}
          key={option.value}
          className={cn(
            'relative flex justify-center items-center px-2.5 py-1.5 gap-1 rounded-[10px] transition-colors duration-300 ease-in-out cursor-pointer z-10',
            'system-md-semibold',
            index === activeIndex
              ? 'text-text-primary'
              : 'text-text-tertiary',
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
            && (pluginList?.plugins.length ?? 0) > 0
            && <Badge
              size='s'
              uppercase={true}
              state={BadgeState.Default}
            >
              {pluginList?.plugins.length}
            </Badge>
          }
        </div>
      ))}
    </div>
  )
}

export default TabSlider
