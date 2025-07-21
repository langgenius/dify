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
}) => {
  const { t } = useTranslation()
  const isBasicMode = !!getVarType
  // const [controlPromptEditorRerenderKey] =
  const isCode = generatorType === 'code'
  const placeholder = (
    <div className='system-sm-regular  text-text-placeholder'>
      <div className='leading-6'>{t(`${i18nPrefix}.instructionPlaceHolderTitle`)}</div>
      <div className='mt-2'>
        <div>{t(`${i18nPrefix}.instructionPlaceHolderLine1`)}</div>
        <div>{t(`${i18nPrefix}.instructionPlaceHolderLine2`)}</div>
        <div>{t(`${i18nPrefix}.instructionPlaceHolderLine3`)}</div>
      </div>
    </div>
  )

  return (
    <div>
      <PromptEditor
        wrapperClassName='border !border-components-input-bg-normal bg-components-input-bg-normal hover:!border-components-input-bg-hover rounded-[10px] px-4 pt-3'
        key={editorKey}
        placeholder={placeholder}
        placeholderClassName='px-4 pt-3'
        className={cn('min-h-[240px] ')}
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
          show: true,
        }}
        onChange={onChange}
        editable
        isSupportFileVar={false}
      />
    </div>
  )
}
export default React.memo(InstructionEditor)
