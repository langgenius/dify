'use client'
import type { FC } from 'react'
import React, { useEffect } from 'react'
import cn from 'classnames'
import { useBoolean } from 'ahooks'
import { useTranslation } from 'react-i18next'
import { useWorkflow } from '@/app/components/workflow/hooks'
import type { NodeOutPutVar } from '@/app/components/workflow/types'
import PromptEditor from '@/app/components/base/prompt-editor'
import { Variable02 } from '@/app/components/base/icons/src/vender/solid/development'
import TooltipPlus from '@/app/components/base/tooltip-plus'

type Props = {
  className?: string
  placeholder?: string
  placeholderClassName?: string
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
  placeholderClassName,
  promptMinHeightClassName = 'min-h-[20px]',
  value,
  onChange,
  onFocusChange,
  readOnly,
  nodesOutputVars,
}) => {
  const { t } = useTranslation()

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
          className={cn(promptMinHeightClassName, '!leading-[18px]')}
          placeholder={placeholder}
          placeholderClassName={placeholderClassName}
          value={value}
          contextBlock={{
            show: false,
            selectable: false,
            datasets: [],
            onAddContext: () => { },
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
        {isFocus && (
          <div className='absolute z-10 top-[-9px] right-1'>
            <TooltipPlus
              popupContent={`${t('workflow.common.insertVarTip')}`}
            >
              <div className='p-0.5 rounded-[5px] shadow-lg cursor-pointer bg-white hover:bg-gray-100 border-[0.5px] border-black/5'>
                <Variable02 className='w-3.5 h-3.5 text-gray-500' />
              </div>
            </TooltipPlus>
          </div>
        )}
      </>
    </div >
  )
}
export default React.memo(Editor)
