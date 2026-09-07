import type { DragEvent } from 'react'
import { cn } from '@langgenius/dify-ui/cn'

export function setSkillFileDragPreview(
  event: DragEvent<HTMLElement>,
  {
    count,
    iconClassName,
    name,
  }: {
    count: number
    iconClassName: string
    name: string
  },
) {
  if (typeof event.dataTransfer.setDragImage !== 'function') return

  const preview = document.createElement('div')
  preview.className =
    'fixed -left-[9999px] top-0 z-50 flex h-6 max-w-48 items-center rounded-md border-[0.5px] border-components-panel-border bg-components-tooltip-bg px-1 system-xs-regular text-text-secondary shadow-lg shadow-shadow-shadow-5 backdrop-blur-[5px]'

  if (count > 1) {
    const countLabel = document.createElement('span')
    countLabel.className = 'px-1 py-0.5'
    countLabel.textContent = `${count} items`
    preview.append(countLabel)
  } else {
    const icon = document.createElement('span')
    icon.setAttribute('aria-hidden', 'true')
    icon.className = cn('size-4 shrink-0', iconClassName)
    const label = document.createElement('span')
    label.className = 'max-w-36 truncate px-1 py-0.5'
    label.textContent = name
    preview.append(icon, label)
  }

  document.body.append(preview)
  event.dataTransfer.setDragImage(preview, 10, 12)
  requestAnimationFrame(() => preview.remove())
}
