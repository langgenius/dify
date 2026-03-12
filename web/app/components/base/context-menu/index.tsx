import type { FC } from 'react'
import { memo, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/utils/classnames'

type ContextMenuItem = {
  label: string
  onClick: () => void
  isDanger?: boolean
}

type ContextMenuProps = {
  x: number
  y: number
  items: ContextMenuItem[]
  onClose: () => void
}

const ContextMenu: FC<ContextMenuProps> = ({ x, y, items, onClose }) => {
  useEffect(() => {
    const handleClick = () => onClose()
    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault()
      onClose()
    }

    document.addEventListener('click', handleClick)
    document.addEventListener('contextmenu', handleContextMenu)

    return () => {
      document.removeEventListener('click', handleClick)
      document.removeEventListener('contextmenu', handleContextMenu)
    }
  }, [onClose])

  return createPortal(
    <div
      className="fixed z-[10000002] min-w-[160px] rounded-lg border-[0.5px] border-components-panel-border bg-components-panel-bg-blur p-1 shadow-lg backdrop-blur-[5px]"
      style={{ left: x, top: y }}
      onClick={e => e.stopPropagation()}
    >
      {items.map((item, index) => (
        <div
          key={index}
          className={cn(
            'flex h-8 cursor-pointer items-center rounded-lg px-3 text-text-secondary system-sm-medium',
            item.isDanger ? 'hover:bg-state-destructive-hover hover:text-text-destructive' : 'hover:bg-state-base-hover',
          )}
          onClick={(e) => {
            e.stopPropagation()
            item.onClick()
          }}
        >
          {item.label}
        </div>
      ))}
    </div>,
    document.body,
  )
}

export default memo(ContextMenu)
