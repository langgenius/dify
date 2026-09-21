'use client'

import type { ComponentProps } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { useTranslation } from 'react-i18next'
import { getKeyboardResizeValue } from './keyboard'

type ResizeHandleProps = Pick<
  ComponentProps<'div'>,
  'ref' | 'className' | 'children' | 'onMouseDown' | 'onPointerDown'
> & {
  side: 'left' | 'right' | 'top' | 'bottom'
  value: number
  min: number
  max: number
  label: string
  controls: string
  onResize: (value: number) => void
}

export default function ResizeHandle({
  side,
  value,
  min,
  max,
  label,
  controls,
  onResize,
  className,
  ...props
}: ResizeHandleProps) {
  const { t } = useTranslation('common')
  const horizontal = side === 'left' || side === 'right'

  return (
    <div
      {...props}
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-controls={controls}
      aria-orientation={horizontal ? 'vertical' : 'horizontal'}
      aria-valuemin={min}
      aria-valuemax={Math.max(min, max)}
      aria-valuenow={value}
      aria-valuetext={
        horizontal
          ? t(($) => $['resize.width'], { width: Math.round(value) })
          : t(($) => $['resize.height'], { height: Math.round(value) })
      }
      onKeyDown={(event) => {
        const next = getKeyboardResizeValue(event, { side, value, min, max })
        if (next === undefined) return
        event.preventDefault()
        event.stopPropagation()
        onResize(next)
      }}
      className={cn(
        'group/resize rounded-sm focus-visible:bg-state-accent-solid focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden',
        className,
      )}
    />
  )
}
