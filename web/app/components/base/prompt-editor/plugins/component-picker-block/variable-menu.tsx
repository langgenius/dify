import { memo } from 'react'
import { VariableMenuItem } from './variable-option'

type VariableMenuProps = {
  startIndex: number
  selectedIndex: number | null
  options: any[]
  onClick: (index: number, option: any) => void
  onMouseEnter: (index: number, option: any) => void
  queryString: string | null
}
const VariableMenu = ({
  startIndex,
  selectedIndex,
  options,
  onClick,
  onMouseEnter,
  queryString,
}: VariableMenuProps) => {
  return (
    <div className='p-1'>
      {
        options.map((option, index: number) => (
          <VariableMenuItem
            startIndex={startIndex}
            index={index}
            isSelected={selectedIndex === index + startIndex}
            onClick={onClick}
            onMouseEnter={onMouseEnter}
            key={option.key}
            option={option}
            queryString={queryString}
          />
        ))
      }
    </div>
  )
}

export default memo(VariableMenu)
