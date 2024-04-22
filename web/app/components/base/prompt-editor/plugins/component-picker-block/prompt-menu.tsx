import { memo } from 'react'
import { PromptMenuItem } from './prompt-option'

type PromptMenuProps = {
  startIndex: number
  selectedIndex: number | null
  options: any[]
  onClick: (index: number, option: any) => void
  onMouseEnter: (index: number, option: any) => void
}
const PromptMenu = ({
  startIndex,
  selectedIndex,
  options,
  onClick,
  onMouseEnter,
}: PromptMenuProps) => {
  return (
    <div className='p-1'>
      {
        options.map((option, index: number) => (
          <PromptMenuItem
            startIndex={startIndex}
            index={index}
            isSelected={selectedIndex === index + startIndex}
            onClick={onClick}
            onMouseEnter={onMouseEnter}
            key={option.key}
            option={option}
          />
        ))
      }
    </div>
  )
}

export default memo(PromptMenu)
