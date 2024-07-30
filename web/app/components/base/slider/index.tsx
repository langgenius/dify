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
    value={isNaN(value) ? 0 : value}
    min={min || 0}
    max={max || 100}
    step={step || 1}
    className={cn('slider', className)}
    thumbClassName={cn('slider-thumb', thumbClassName)}
    trackClassName={cn('slider-track', trackClassName)}
    onChange={onChange}
  />
}

export default Slider
