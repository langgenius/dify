import ReactSlider from 'react-slider'
import s from './style.module.css'
import cn from '@/utils/classnames'

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
    className={cn(className, s.slider)}
    thumbClassName={cn(s['slider-thumb'], 'top-[-7px] w-2 h-[18px] bg-white border !border-black/8 rounded-[36px] shadow-md cursor-pointer')}
    trackClassName={s['slider-track']}
    onChange={onChange}
    renderThumb={(props, state) => (
      <div {...props}>
        <div className='relative w-full h-full'>
          <div className='absolute top-[-16px] left-[50%] translate-x-[-50%] leading-[18px] text-xs font-medium text-gray-900'>
            {(state.valueNow / 100).toFixed(2)}
          </div>
        </div>
      </div>
    )}
  />
}

export default Slider
