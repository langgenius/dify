import ReactSlider from 'react-slider'
import cn from '@/utils/classnames'
import './style.css'

type ISliderProps = {
  className?: string
  value: number
  max?: number
  min?: number
  step?: number
  disabled?: boolean
  onChange: (value: number) => void
}

const Slider: React.FC<ISliderProps> = ({ className, max, min, step, value, disabled, onChange }) => {
  return <ReactSlider
    disabled={disabled}
    value={isNaN(value) ? 0 : value}
    min={min || 0}
    max={max || 100}
    step={step || 1}
    className={cn(className, 'slider')}
    thumbClassName="slider-thumb"
    trackClassName="slider-track"
    onChange={onChange}
  />
}

export default Slider
