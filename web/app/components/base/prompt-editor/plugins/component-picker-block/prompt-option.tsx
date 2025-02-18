import { memo } from 'react'

type PromptMenuItemMenuItemProps = {
  icon: React.JSX.Element
  title: string
  disabled?: boolean
  isSelected: boolean
  onClick: () => void
  onMouseEnter: () => void
  setRefElement?: (element: HTMLDivElement) => void
}
export const PromptMenuItem = memo(({
  icon,
  title,
  disabled,
  isSelected,
  onClick,
  onMouseEnter,
  setRefElement,
}: PromptMenuItemMenuItemProps) => {
  return (
    <div
      className={`
        hover:bg-state-base-hover flex h-6 cursor-pointer items-center rounded-md px-3
        ${isSelected && !disabled && '!bg-state-base-hover'}
        ${disabled ? 'cursor-not-allowed opacity-30' : 'hover:bg-state-base-hover cursor-pointer'}
      `}
      tabIndex={-1}
      ref={setRefElement}
      onMouseEnter={() => {
        if (disabled)
          return
        onMouseEnter()
      }}
      onClick={() => {
        if (disabled)
          return
        onClick()
      }}>
      {icon}
      <div className='text-text-secondary ml-1 text-[13px]'>{title}</div>
    </div>
  )
})
PromptMenuItem.displayName = 'PromptMenuItem'
