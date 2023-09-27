import type { FC } from 'react'

type Option = {
  value: string
  text: string
}
type TabSliderProps = {
  value: string
  onChange: (v: string) => void
  options: Option[]
}
const TabSlider: FC<TabSliderProps> = ({
  value,
  onChange,
  options,
}) => {
  const currentIndex = options.findIndex(option => option.value === value)
  const current = options[currentIndex]

  return (
    <div className='relative flex p-0.5 rounded-lg bg-gray-200'>
      {
        options.map((option, index) => (
          <div
            key={option.value}
            className={`
              flex justify-center items-center w-[118px] h-7 text-[13px] 
              font-semibold text-gray-600 rounded-[7px] cursor-pointer
              hover:bg-gray-50
              ${index !== options.length - 1 && 'mr-[1px]'}
            `}
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
              absolute flex justify-center items-center w-[118px] h-7 bg-white text-[13px] font-semibold text-primary-600 
              border-[0.5px] border-gray-200 rounded-[7px] shadow-xs transition-transform
            `}
            style={{ transform: `translateX(${currentIndex * 118 + 1}px)` }}
          >
            {current.text}
          </div>
        )
      }
    </div>
  )
}

export default TabSlider
