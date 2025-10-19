import ReactSlider from 'react-slider'
import cn from '@/utils/classnames'
import './style.css'

type ISliderProps = {
  className?: string
  thumbClassName?: string
  trackClassName?: string
  value: number
  max?: number
  min?: number
  step?: number
  disabled?: boolean
  onChange: (value: number) => void
}

const Slider: React.FC<ISliderProps> = ({
  className,
  thumbClassName,
  trackClassName,
  max,
  min,
  step,
  value,
  disabled,
  onChange,
}) => {
  return <ReactSlider
    disabled={disabled}
    value={Number.isNaN(value) ? 0 : value}
    min={min || 0}
    max={max || 100}
    step={step || 1}
    className={cn('slider relative', className)}
    thumbClassName={cn('absolute top-[-9px] h-5 w-2 rounded-[3px] border-[0.5px] border-components-slider-knob-border bg-components-slider-knob shadow-sm  focus:outline-none', !disabled && 'cursor-pointer', thumbClassName)}
    trackClassName={cn('h-0.5 rounded-full', 'slider-track', trackClassName)}
    onChange={onChange}
  />
}

export default Slider
