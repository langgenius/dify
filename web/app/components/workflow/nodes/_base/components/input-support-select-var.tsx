'use client'
import type { FC } from 'react'
import React, { useEffect } from 'react'
import cn from 'classnames'
import { useBoolean } from 'ahooks'
import { useWorkflow } from '@/app/components/workflow/hooks'
import type { NodeOutPutVar } from '@/app/components/workflow/types'
import PromptEditor from '@/app/components/base/prompt-editor'
type Props = {
  className?: string
  placeholder?: string
  promptMinHeightClassName?: string
  value: string
  onChange: (value: string) => void
  onFocusChange?: (value: boolean) => void
  readOnly?: boolean
  justVar?: boolean
  nodesOutputVars?: NodeOutPutVar[]
}

const Editor: FC<Props> = ({
  className,
  placeholder,
  promptMinHeightClassName = 'min-h-[30px]',
  value,
  onChange,
  onFocusChange,
  readOnly,
  nodesOutputVars,
}) => {
  // const { t } = useTranslation()
  const { getNode } = useWorkflow()

  const [isFocus, {
    setTrue: setFocus,
    setFalse: setBlur,
  }] = useBoolean(false)

  useEffect(() => {
    onFocusChange?.(isFocus)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFocus])

  return (
    <div className={cn(className, 'relative')}>
      <>
        <PromptEditor
          className={cn(promptMinHeightClassName)}
          // style={isExpand ? { height: editorExpandHeight - 5 } : {}}
          placeholder={placeholder}
          value={value}
          outToolDisabled
          canNotAddContext
          contextBlock={{
            show: false,
            selectable: false,
            datasets: [],
            onAddContext: () => { },
          }}
          variableBlock={{
            variables: [],
            externalTools: [],
            onAddExternalTool: () => { },
          }}
          historyBlock={{
            show: false,
            selectable: false,
            history: {
              user: 'Human',
              assistant: 'Assistant',
            },
            onEditRole: () => { },
          }}
          queryBlock={{
            show: false,
            selectable: false,
          }}
          workflowVariableBlock={{
            show: true,
            selectable: true,
            variables: nodesOutputVars || [],
            getWorkflowNode: getNode,
          }}
          onChange={onChange}
          editable={!readOnly}
          onBlur={setBlur}
          onFocus={setFocus}
        />
        {/* to patch Editor not support dynamic change editable status */}
        {readOnly && <div className='absolute inset-0 z-10'></div>}
      </>
    </div >
  )
}
export default React.memo(Editor)
