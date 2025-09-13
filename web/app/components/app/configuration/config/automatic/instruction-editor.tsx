'use client'
import type { FC } from 'react'
import React from 'react'
import PromptEditor from '@/app/components/base/prompt-editor'
import type { GeneratorType } from './types'
import cn from '@/utils/classnames'
import type { Node, NodeOutPutVar, ValueSelector } from '@/app/components/workflow/types'
import { BlockEnum } from '@/app/components/workflow/types'
import { useTranslation } from 'react-i18next'
import { Type } from '@/app/components/workflow/nodes/llm/types'
import { PROMPT_EDITOR_INSERT_QUICKLY } from '@/app/components/base/prompt-editor/plugins/update-block'
import { useEventEmitterContextContext } from '@/context/event-emitter'

type Props = {
  editorKey: string
  value: string
  onChange: (text: string) => void
  generatorType: GeneratorType
  availableVars: NodeOutPutVar[]
  availableNodes: Node[]
  getVarType?: (params: {
    nodeId: string,
    valueSelector: ValueSelector,
  }) => Type
  isShowCurrentBlock: boolean
  isShowLastRunBlock: boolean
}

const i18nPrefix = 'appDebug.generate'

const InstructionEditor: FC<Props> = ({
  editorKey,
  generatorType,
  value,
  onChange,
  availableVars,
  availableNodes,
  getVarType = () => Type.string,
  isShowCurrentBlock,
  isShowLastRunBlock,
}) => {
  const { t } = useTranslation()
  const { eventEmitter } = useEventEmitterContextContext()

  const isCode = generatorType === 'code'
  const placeholder = isCode ? <div className='system-sm-regular whitespace-break-spaces !leading-6 text-text-placeholder'>
    {t(`${i18nPrefix}.codeGenInstructionPlaceHolderLine`)}
  </div> : (
    <div className='system-sm-regular text-text-placeholder'>
      <div className='leading-6'>{t(`${i18nPrefix}.instructionPlaceHolderTitle`)}</div>
      <div className='mt-2'>
        <div>{t(`${i18nPrefix}.instructionPlaceHolderLine1`)}</div>
        <div>{t(`${i18nPrefix}.instructionPlaceHolderLine2`)}</div>
        <div>{t(`${i18nPrefix}.instructionPlaceHolderLine3`)}</div>
      </div>
    </div>
  )

  const handleInsertVariable = () => {
    eventEmitter?.emit({ type: PROMPT_EDITOR_INSERT_QUICKLY, instanceId: editorKey } as any)
  }

  return (
    <div className='relative'>
      <PromptEditor
        wrapperClassName='border !border-components-input-bg-normal bg-components-input-bg-normal hover:!border-components-input-bg-hover rounded-[10px] px-4 pt-3'
        key={editorKey}
        instanceId={editorKey}
        placeholder={placeholder}
        placeholderClassName='px-4 pt-3'
        className={cn('min-h-[240px] pb-8')}
        value={value}
        workflowVariableBlock={{
          show: true,
          variables: availableVars,
          getVarType,
          workflowNodesMap: availableNodes.reduce((acc, node) => {
            acc[node.id] = {
              title: node.data.title,
              type: node.data.type,
              width: node.width,
              height: node.height,
              position: node.position,
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
        currentBlock={{
          show: isShowCurrentBlock,
          generatorType,
        }}
        errorMessageBlock={{
          show: isCode,
        }}
        lastRunBlock={{
          show: isShowLastRunBlock,
        }}
        onChange={onChange}
        editable
        isSupportFileVar={false}
      />
      <div className='system-xs-regular absolute bottom-0 left-4 flex h-8 items-center space-x-0.5 text-components-input-text-placeholder'>
        <span>{t('appDebug.generate.press')}</span>
        <span className='system-kbd flex h-4 w-3.5 items-center justify-center rounded-[4px] bg-components-kbd-bg-gray text-text-placeholder'>/</span>
        <span>{t('appDebug.generate.to')}</span>
        <span onClick={handleInsertVariable} className='!ml-1 cursor-pointer hover:border-b hover:border-dotted hover:border-text-tertiary hover:text-text-tertiary'>{t('appDebug.generate.insertContext')}</span>
      </div>
    </div>
  )
}
export default React.memo(InstructionEditor)
