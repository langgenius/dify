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
    thumbClassName={cn(s['slider-thumb'], 'top-[-7px] h-[18px] w-2 cursor-pointer rounded-[36px] border !border-black/8 bg-white shadow-md')}
    trackClassName={s['slider-track']}
    onChange={onChange}
    renderThumb={(props, state) => (
      <div {...props}>
        <div className='relative h-full w-full'>
          <div className='system-sm-semibold absolute left-[50%] top-[-16px] translate-x-[-50%] text-text-primary'>
            {(state.valueNow / 100).toFixed(2)}
          </div>
        </div>
      </div>
    )}
  />
}

export default Slider
