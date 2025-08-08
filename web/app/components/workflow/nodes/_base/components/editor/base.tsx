'use client'
import type { FC } from 'react'
import React, { useCallback, useRef, useState } from 'react'
import copy from 'copy-to-clipboard'
import ToggleExpandBtn from '../toggle-expand-btn'
import CodeGeneratorButton from '../code-generator-button'
import type { CodeLanguage } from '../../../code/types'
import Wrap from './wrap'
import cn from '@/utils/classnames'
import PromptEditorHeightResizeWrap from '@/app/components/app/configuration/config-prompt/prompt-editor-height-resize-wrap'
import {
  Copy,
  CopyCheck,
} from '@/app/components/base/icons/src/vender/line/files'
import useToggleExpend from '@/app/components/workflow/nodes/_base/hooks/use-toggle-expend'
import type { FileEntity } from '@/app/components/base/file-uploader/types'
import FileListInLog from '@/app/components/base/file-uploader/file-list-in-log'
import ActionButton from '@/app/components/base/action-button'

type Props = {
  className?: string
  title: React.JSX.Element | string
  headerRight?: React.JSX.Element
  children: React.JSX.Element
  minHeight?: number
  value: string
  isFocus: boolean
  isInNode?: boolean
  onGenerated?: (prompt: string) => void
  codeLanguages?: CodeLanguage
  fileList?: {
    varName: string
    list: FileEntity[]
  }[]
  showFileList?: boolean
  showCodeGenerator?: boolean
  tip?: React.JSX.Element
}

const Base: FC<Props> = ({
  className,
  title,
  headerRight,
  children,
  minHeight = 120,
  value,
  isFocus,
  isInNode,
  onGenerated,
  codeLanguages,
  fileList = [],
  showFileList,
  showCodeGenerator = false,
  tip,
}) => {
  const ref = useRef<HTMLDivElement>(null)
  const {
    wrapClassName,
    wrapStyle,
    isExpand,
    setIsExpand,
    editorExpandHeight,
  } = useToggleExpend({ ref, hasFooter: false, isInNode })

  const editorContentMinHeight = minHeight - 28
  const [editorContentHeight, setEditorContentHeight] = useState(editorContentMinHeight)

  const [isCopied, setIsCopied] = React.useState(false)
  const handleCopy = useCallback(() => {
    copy(value)
    setIsCopied(true)
    setTimeout(() => {
      setIsCopied(false)
    }, 2000)
  }, [value])

  return (
    <Wrap className={cn(wrapClassName)} style={wrapStyle} isInNode={isInNode} isExpand={isExpand}>
      <div ref={ref} className={cn(className, isExpand && 'h-full', 'rounded-lg border', !isFocus ? 'border-transparent bg-components-input-bg-normal' : 'overflow-hidden border-components-input-border-hover bg-components-input-bg-hover')}>
        <div className='flex h-7 items-center justify-between pl-3 pr-2 pt-1'>
          <div className='system-xs-semibold-uppercase text-text-secondary'>{title}</div>
          <div className='flex items-center' onClick={(e) => {
            e.nativeEvent.stopImmediatePropagation()
            e.stopPropagation()
          }}>
            {headerRight}
            {showCodeGenerator && codeLanguages && (
              <div className='ml-1'>
                <CodeGeneratorButton onGenerated={onGenerated} codeLanguages={codeLanguages} />
              </div>
            )}
            <ActionButton className='ml-1' onClick={handleCopy}>
              {!isCopied
                ? (
                  <Copy className='h-4 w-4 cursor-pointer' />
                )
                : (
                  <CopyCheck className='h-4 w-4' />
                )
              }
            </ActionButton>
            <div className='ml-1'>
              <ToggleExpandBtn isExpand={isExpand} onExpandChange={setIsExpand} />
            </div>
          </div>
        </div>
        {tip && <div className='px-1 py-0.5'>{tip}</div>}
        <PromptEditorHeightResizeWrap
          height={isExpand ? editorExpandHeight : editorContentHeight}
          minHeight={editorContentMinHeight}
          onHeightChange={setEditorContentHeight}
          hideResize={isExpand}
        >
          <div className='h-full pb-2 pl-2'>
            {children}
          </div>
        </PromptEditorHeightResizeWrap>
        {showFileList && fileList.length > 0 && (
          <FileListInLog fileList={fileList} />
        )}
      </div>
    </Wrap>
  )
}
export default React.memo(Base)
