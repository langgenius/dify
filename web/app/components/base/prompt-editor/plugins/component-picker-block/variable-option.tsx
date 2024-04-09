import { memo } from 'react'
import { MenuOption } from '@lexical/react/LexicalTypeaheadMenuPlugin'

export class VariableOption extends MenuOption {
  title: string
  icon?: JSX.Element
  extraElement?: JSX.Element
  keywords: Array<string>
  keyboardShortcut?: string
  onSelect: (queryString: string) => void

  constructor(
    title: string,
    options: {
      icon?: JSX.Element
      extraElement?: JSX.Element
      keywords?: Array<string>
      keyboardShortcut?: string
      onSelect: (queryString: string) => void
    },
  ) {
    super(title)
    this.title = title
    this.keywords = options.keywords || []
    this.icon = options.icon
    this.extraElement = options.extraElement
    this.keyboardShortcut = options.keyboardShortcut
    this.onSelect = options.onSelect.bind(this)
  }
}

type VariableMenuItemProps = {
  startIndex: number
  index: number
  isSelected: boolean
  onClick: (index: number, option: VariableOption) => void
  onMouseEnter: (index: number, option: VariableOption) => void
  option: VariableOption
  queryString: string | null
}
export const VariableMenuItem = memo(({
  startIndex,
  index,
  isSelected,
  onClick,
  onMouseEnter,
  option,
  queryString,
}: VariableMenuItemProps) => {
  const title = option.title
  let before = title
  let middle = ''
  let after = ''

  if (queryString) {
    const regex = new RegExp(queryString, 'i')
    const match = regex.exec(option.title)

    if (match) {
      before = title.substring(0, match.index)
      middle = match[0]
      after = title.substring(match.index + match[0].length)
    }
  }

  return (
    <div
      key={option.key}
      className={`
        flex items-center px-3 h-6 rounded-md hover:bg-primary-50 cursor-pointer
        ${isSelected && 'bg-primary-50'}
      `}
      tabIndex={-1}
      ref={option.setRefElement}
      onMouseEnter={() => onMouseEnter(index + startIndex, option)}
      onClick={() => onClick(index + startIndex, option)}>
      <div className='mr-2'>
        {option.icon}
      </div>
      <div className='grow text-[13px] text-gray-900 truncate' title={option.title}>
        {before}
        <span className='text-[#2970FF]'>{middle}</span>
        {after}
      </div>
      {option.extraElement}
    </div>
  )
})
VariableMenuItem.displayName = 'VariableMenuItem'
