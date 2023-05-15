import ReactSlider from 'react-slider'
import './style.css'
type ISliderProps = {
  value: number
  max?: number
  min?: number
  step?: number
  onChange: (value: number) => void
}

const Slider: React.FC<ISliderProps> = ({ max, min, step, value, onChange }) => {
  return <ReactSlider
        value={value}
        min={min || 0}
        max={max || 100}
        step={step || 1}
        className="slider"
        thumbClassName="slider-thumb"
        trackClassName="slider-track"
        onChange={onChange}
    />
}

export default Slider
