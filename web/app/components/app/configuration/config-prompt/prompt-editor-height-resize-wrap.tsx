'use client'
import React, { useCallback, useEffect, useState } from 'react'
import type { FC } from 'react'
import { useDebounceFn } from 'ahooks'
import cn from '@/utils/classnames'

type Props = {
  className?: string
  height: number
  minHeight: number
  onHeightChange: (height: number) => void
  children: JSX.Element
  footer?: JSX.Element
  hideResize?: boolean
}

const PromptEditorHeightResizeWrap: FC<Props> = ({
  className,
  height,
  minHeight,
  onHeightChange,
  children,
  footer,
  hideResize,
}) => {
  const [clientY, setClientY] = useState(0)
  const [isResizing, setIsResizing] = useState(false)
  const [prevUserSelectStyle, setPrevUserSelectStyle] = useState(getComputedStyle(document.body).userSelect)

  const handleStartResize = useCallback((e: React.MouseEvent<HTMLElement>) => {
    setClientY(e.clientY)
    setIsResizing(true)
    setPrevUserSelectStyle(getComputedStyle(document.body).userSelect)
    document.body.style.userSelect = 'none'
  }, [])

  const handleStopResize = useCallback(() => {
    setIsResizing(false)
    document.body.style.userSelect = prevUserSelectStyle
  }, [prevUserSelectStyle])

  const { run: didHandleResize } = useDebounceFn((e) => {
    if (!isResizing)
      return

    const offset = e.clientY - clientY
    let newHeight = height + offset
    setClientY(e.clientY)
    if (newHeight < minHeight)
      newHeight = minHeight
    onHeightChange(newHeight)
  }, {
    wait: 0,
  })

  const handleResize = useCallback(didHandleResize, [isResizing, height, minHeight, clientY])

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
    <div
      className='relative'
    >
      <div className={cn(className, 'overflow-y-auto')}
        style={{
          height,
        }}
      >
        {children}
      </div>
      {/* resize handler */}
      {footer}
      {!hideResize && (
        <div
          className='absolute bottom-0 left-0 w-full flex justify-center h-2 cursor-row-resize'
          onMouseDown={handleStartResize}>
          <div className='w-5 h-[3px] rounded-sm bg-gray-300'></div>
        </div>
      )}
    </div>
  )
}
export default React.memo(PromptEditorHeightResizeWrap)
