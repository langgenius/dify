'use client'
import type { FC } from 'react'
import React, { useCallback, useState } from 'react'
import copy from 'copy-to-clipboard'
import cn from 'classnames'
import PromptEditorHeightResizeWrap from '@/app/components/app/configuration/config-prompt/prompt-editor-height-resize-wrap'
import { Clipboard, ClipboardCheck } from '@/app/components/base/icons/src/vender/line/files'
import { Expand04 } from '@/app/components/base/icons/src/vender/solid/arrows'
type Props = {
  className?: string
  title: JSX.Element | string
  headerRight?: JSX.Element
  children: JSX.Element
  minHeight?: number
  value: string
  isFocus: boolean
}

const Base: FC<Props> = ({
  className,
  title,
  headerRight,
  children,
  minHeight = 120,
  value,
  isFocus,
}) => {
  const editorContentMinHeight = minHeight - 28
  const [editorContentHeight, setEditorContentHeight] = useState(editorContentMinHeight)

  const [isCopied, setIsCopied] = React.useState(false)
  const handleCopy = useCallback(() => {
    copy(value)
    setIsCopied(true)
  }, [value])

  const [isExpanded, setIsExpanded] = React.useState(false)
  const toggleExpand = useCallback(() => {
    setIsExpanded(!isExpanded)
  }, [isExpanded])

  return (
    <div className={cn(className, 'rounded-lg border', isFocus ? 'bg-white border-gray-200' : 'bg-gray-100 border-gray-100 overflow-hidden')}>
      <div className='flex justify-between items-center h-7 pt-1 pl-3 pr-1'>
        <div className='text-xs font-semibold text-gray-700'>{title}</div>
        <div className='flex items-center'>
          {headerRight}
          {!isCopied
            ? (
              <Clipboard className='mx-1 w-3.5 h-3.5 text-gray-500 cursor-pointer' onClick={handleCopy} />
            )
            : (
              <ClipboardCheck className='mx-1 w-3.5 h-3.5 text-gray-500' />
            )
          }
          <Expand04 className='ml-2 mr-2 w-3.5 h-3.5 text-gray-500 cursor-pointer' onClick={toggleExpand} />
        </div>
      </div>
      <PromptEditorHeightResizeWrap
        height={editorContentHeight}
        minHeight={editorContentMinHeight}
        onHeightChange={setEditorContentHeight}
      >
        <div className='h-full'>
          {children}
        </div>
      </PromptEditorHeightResizeWrap>
    </div>
  )
}
export default React.memo(Base)
