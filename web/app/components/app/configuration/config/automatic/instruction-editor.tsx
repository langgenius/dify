'use client'
import type { FC } from 'react'
import React from 'react'
import PromptEditor from '@/app/components/base/prompt-editor'
import type { GeneratorType } from './types'
import cn from '@/utils/classnames'
import { useStore } from '@/app/components/workflow/store'
import type { Node, NodeOutPutVar } from '@/app/components/workflow/types'
import { BlockEnum } from '@/app/components/workflow/types'
import { useWorkflowVariableType } from '@/app/components/workflow/hooks'
import { useTranslation } from 'react-i18next'

type Props = {
  value: string
  onChange: (text: string) => void
  nodesOutputVars?: NodeOutPutVar[]
  availableNodes?: Node[]
  generatorType: GeneratorType
}

const i18nPrefix = 'appDebug.generate'

const InstructionEditor: FC<Props> = ({
  generatorType,
  nodesOutputVars = [],
  availableNodes = [],
  value,
  onChange,
}) => {
  const { t } = useTranslation()
  const controlPromptEditorRerenderKey = useStore(s => s.controlPromptEditorRerenderKey)
  const getVarType = useWorkflowVariableType()
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
        key={controlPromptEditorRerenderKey}
        placeholder={placeholder}
        placeholderClassName='px-4 pt-3'
        className={cn('min-h-[240px] ')}
        value={value}
        workflowVariableBlock={{
          show: true,
          variables: nodesOutputVars,
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
          show: true,
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
