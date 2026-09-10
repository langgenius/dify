'use client'
import type { FC } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { useDebounceFn } from 'ahooks'
import * as React from 'react'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getKeyboardResizeValue } from '@/app/components/base/resize-handle/keyboard'

type Props = Readonly<{
  className?: string
  height: number
  minHeight: number
  onHeightChange: (height: number) => void
  children: React.JSX.Element
  footer?: React.JSX.Element
  hideResize?: boolean
}>

const PromptEditorHeightResizeWrap: FC<Props> = ({
  className,
  height,
  minHeight,
  onHeightChange,
  children,
  footer,
  hideResize,
}) => {
  const { t } = useTranslation('common')
  const editorId = useId()
  const resizeDescriptionId = useId()
  const didDragRef = useRef(false)
  const [clientY, setClientY] = useState(0)
  const [isResizing, setIsResizing] = useState(false)
  const [prevUserSelectStyle, setPrevUserSelectStyle] = useState(
    () => getComputedStyle(document.body).userSelect,
  )
  const [oldHeight, setOldHeight] = useState(height)

  const handleStartResize = useCallback(
    (e: React.MouseEvent<HTMLElement>) => {
      didDragRef.current = false
      setClientY(e.clientY)
      setIsResizing(true)
      setOldHeight(height)
      setPrevUserSelectStyle(getComputedStyle(document.body).userSelect)
      document.body.style.userSelect = 'none'
    },
    [height],
  )

  const handleStopResize = useCallback(() => {
    setIsResizing(false)
    document.body.style.userSelect = prevUserSelectStyle
  }, [prevUserSelectStyle])

  const { run: didHandleResize } = useDebounceFn(
    (e) => {
      if (!isResizing) return

      const offset = e.clientY - clientY
      let newHeight = oldHeight + offset
      if (newHeight < minHeight) newHeight = minHeight
      onHeightChange(newHeight)
    },
    {
      wait: 0,
    },
  )

  const handleResize = useCallback(
    (event: MouseEvent) => {
      if (isResizing && event.clientY !== clientY) didDragRef.current = true
      didHandleResize(event)
    },
    [didHandleResize, isResizing, clientY],
  )

  useEffect(() => {
    document.addEventListener('mousemove', handleResize)
    return () => {
      document.removeEventListener('mousemove', handleResize)
    }
  }, [handleResize])

  useEffect(() => {
    document.addEventListener('mouseup', handleStopResize)
    return () => {
      document.removeEventListener('mouseup', handleStopResize)
    }
  }, [handleStopResize])

  return (
    <div className="relative">
      <div
        id={editorId}
        className={cn(className, 'overflow-y-auto')}
        style={{
          height,
        }}
      >
        {children}
      </div>
      {/* resize handler */}
      {footer}
      {!hideResize && (
        <>
          <IconButton
            aria-label={t(($) => $['resize.editor'])}
            aria-controls={editorId}
            aria-describedby={resizeDescriptionId}
            className="group/resize absolute bottom-0 left-0 h-2 w-full cursor-row-resize"
            onMouseDown={handleStartResize}
            onClick={(event) => {
              if (event.detail === 0 || !didDragRef.current) onHeightChange(minHeight)
              didDragRef.current = false
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') event.stopPropagation()
              const next = getKeyboardResizeValue(event, {
                side: 'bottom',
                value: height,
                min: minHeight,
              })
              if (next === undefined) return
              event.preventDefault()
              event.stopPropagation()
              onHeightChange(next)
            }}
          >
            <span
              aria-hidden="true"
              className="h-0.75 w-5 rounded-xs bg-state-base-handle group-focus-visible/resize:w-full group-focus-visible/resize:bg-state-accent-solid"
            />
          </IconButton>
          <span id={resizeDescriptionId} className="sr-only" aria-live="polite">
            {t(($) => $['resize.height'], { height: Math.round(height) })}{' '}
            {t(($) => $['resize.editorHelp'])}
          </span>
        </>
      )}
    </div>
  )
}
export default React.memo(PromptEditorHeightResizeWrap)
