import { memo } from 'react'

type VariableMenuItemProps = {
  title: string
  icon?: JSX.Element
  extraElement?: JSX.Element
  isSelected: boolean
  queryString: string | null
  onClick: () => void
  onMouseEnter: () => void
  setRefElement?: (element: HTMLDivElement) => void
}
export const VariableMenuItem = memo(({
  title,
  icon,
  extraElement,
  isSelected,
  queryString,
  onClick,
  onMouseEnter,
  setRefElement,
}: VariableMenuItemProps) => {
  let before = title
  let middle = ''
  let after = ''

  if (queryString) {
    const regex = new RegExp(queryString, 'i')
    const match = regex.exec(title)

    if (match) {
      before = title.substring(0, match.index)
      middle = match[0]
      after = title.substring(match.index + match[0].length)
    }
  }

  return (
    <div
      className={`
        flex items-center px-3 h-6 rounded-md hover:bg-primary-50 cursor-pointer
        ${isSelected && 'bg-primary-50'}
      `}
      tabIndex={-1}
      ref={setRefElement}
      onMouseEnter={onMouseEnter}
      onClick={onClick}>
      <div className='mr-2'>
        {icon}
      </div>
      <div className='grow text-[13px] text-gray-900 truncate' title={title}>
        {before}
        <span className='text-[#2970FF]'>{middle}</span>
        {after}
      </div>
      {extraElement}
    </div>
  )
})
VariableMenuItem.displayName = 'VariableMenuItem'
