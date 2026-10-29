import { escapeRegExp } from 'es-toolkit/string'
import { memo } from 'react'

type VariableMenuItemProps = {
  title: string
  icon?: React.JSX.Element
  extraElement?: React.JSX.Element
  isSelected: boolean
  queryString: string | null
  onClick: () => void
  onMouseEnter: () => void
  setRefElement?: (element: HTMLButtonElement) => void
}
export const VariableMenuItem = memo(
  ({
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
      const match = new RegExp(escapeRegExp(queryString), 'i').exec(title)

      if (match) {
        before = title.substring(0, match.index)
        middle = match[0]
        after = title.substring(match.index + match[0].length)
      }
    }

    return (
      <button
        type="button"
        role="option"
        aria-selected={isSelected}
        className={`flex h-6 w-full cursor-pointer items-center rounded-md px-3 text-start hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden ${isSelected ? 'bg-state-base-hover' : ''}`}
        tabIndex={-1}
        ref={setRefElement}
        onMouseEnter={onMouseEnter}
        onMouseDown={(e) => {
          e.preventDefault()
          e.stopPropagation()
        }}
        onClick={onClick}
      >
        <span aria-hidden className="me-2">
          {icon}
        </span>
        <span className="sr-only">{title}</span>
        <span aria-hidden className="grow truncate text-[13px] text-text-secondary" title={title}>
          {before}
          <span className="text-text-accent">{middle}</span>
          {after}
        </span>
        {extraElement}
      </button>
    )
  },
)
VariableMenuItem.displayName = 'VariableMenuItem'
