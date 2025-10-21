import { memo } from 'react'

type VariableMenuItemProps = {
  title: string
  icon?: React.JSX.Element
  extraElement?: React.JSX.Element
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
        flex h-6 cursor-pointer items-center rounded-md px-3 hover:bg-state-base-hover
        ${isSelected && 'bg-state-base-hover'}
      `}
      tabIndex={-1}
      ref={setRefElement}
      onMouseEnter={onMouseEnter}
      onMouseDown={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
      onClick={onClick}>
      <div className='mr-2'>
        {icon}
      </div>
      <div className='grow truncate text-[13px] text-text-secondary' title={title}>
        {before}
        <span className='text-text-accent'>{middle}</span>
        {after}
      </div>
      {extraElement}
    </div>
  )
})
VariableMenuItem.displayName = 'VariableMenuItem'
