import { memo } from 'react'
import { MenuOption } from '@lexical/react/LexicalTypeaheadMenuPlugin'

export class PromptOption extends MenuOption {
  title: string
  icon?: JSX.Element
  keywords: Array<string>
  keyboardShortcut?: string
  onSelect: (queryString: string) => void
  disabled?: boolean

  constructor(
    title: string,
    options: {
      icon?: JSX.Element
      keywords?: Array<string>
      keyboardShortcut?: string
      onSelect: (queryString: string) => void
      disabled?: boolean
    },
  ) {
    super(title)
    this.title = title
    this.keywords = options.keywords || []
    this.icon = options.icon
    this.keyboardShortcut = options.keyboardShortcut
    this.onSelect = options.onSelect.bind(this)
    this.disabled = options.disabled
  }
}

type PromptMenuItemMenuItemProps = {
  startIndex: number
  index: number
  isSelected: boolean
  onClick: (index: number, option: PromptOption) => void
  onMouseEnter: (index: number, option: PromptOption) => void
  option: PromptOption
}
export const PromptMenuItem = memo(({
  startIndex,
  index,
  isSelected,
  onClick,
  onMouseEnter,
  option,
}: PromptMenuItemMenuItemProps) => {
  return (
    <div
      key={option.key}
      className={`
        flex items-center px-3 h-6 cursor-pointer hover:bg-gray-50 rounded-md
        ${isSelected && !option.disabled && '!bg-gray-50'}
        ${option.disabled ? 'cursor-not-allowed opacity-30' : 'hover:bg-gray-50 cursor-pointer'}
      `}
      tabIndex={-1}
      ref={option.setRefElement}
      onMouseEnter={() => onMouseEnter(index + startIndex, option)}
      onClick={() => onClick(index + startIndex, option)}>
      {option.icon}
      <div className='ml-1 text-[13px] text-gray-900'>{option.title}</div>
    </div>
  )
})
PromptMenuItem.displayName = 'PromptMenuItem'
