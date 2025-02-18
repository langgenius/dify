'use client'
import type { FC } from 'react'
import React, { useEffect } from 'react'
import { useBoolean } from 'ahooks'
import { useTranslation } from 'react-i18next'
import cn from '@/utils/classnames'
import type {
  Node,
  NodeOutPutVar,
} from '@/app/components/workflow/types'
import { BlockEnum } from '@/app/components/workflow/types'
import PromptEditor from '@/app/components/base/prompt-editor'
import { Variable02 } from '@/app/components/base/icons/src/vender/solid/development'
import Tooltip from '@/app/components/base/tooltip'

type Props = {
  instanceId?: string
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
  availableNodes?: Node[]
  insertVarTipToLeft?: boolean
}

const Editor: FC<Props> = ({
  instanceId,
  className,
  placeholder,
  placeholderClassName,
  promptMinHeightClassName = 'min-h-[20px]',
  value,
  onChange,
  onFocusChange,
  readOnly,
  nodesOutputVars,
  availableNodes = [],
  insertVarTipToLeft,
}) => {
  const { t } = useTranslation()

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
          instanceId={instanceId}
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
            workflowNodesMap: availableNodes.reduce((acc, node) => {
              acc[node.id] = {
                title: node.data.title,
                type: node.data.type,
              }
              if (node.data.type === BlockEnum.Start) {
                acc.sys = {
                  title: t('workflow.blocks.start'),
                  type: BlockEnum.Start,
                }
              }
              return acc
            }, {} as any),
          }}
          onChange={onChange}
          editable={!readOnly}
          onBlur={setBlur}
          onFocus={setFocus}
        />
        {/* to patch Editor not support dynamic change editable status */}
        {readOnly && <div className='absolute inset-0 z-10'></div>}
        {isFocus && (
          <div className={cn('absolute z-10', insertVarTipToLeft ? 'left-[-12px] top-1.5' : ' right-1 top-[-9px]')}>
            <Tooltip
              popupContent={`${t('workflow.common.insertVarTip')}`}
            >
              <div className='cursor-pointer rounded-[5px] border-[0.5px] border-black/5 bg-white p-0.5 shadow-lg hover:bg-gray-100'>
                <Variable02 className='text-components-button-secondary-accent-text h-3.5 w-3.5' />
              </div>
            </Tooltip>
          </div>
        )}
      </>
    </div >
  )
}
export default React.memo(Editor)
