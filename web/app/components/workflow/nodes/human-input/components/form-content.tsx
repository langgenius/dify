'use client'
import PromptEditor from '@/app/components/base/prompt-editor'
import type { FC } from 'react'
import React from 'react'
import useAvailableVarList from '../../_base/hooks/use-available-var-list'
import { BlockEnum } from '../../../types'
import { useWorkflowVariableType } from '../../../hooks'
import { useTranslation } from 'react-i18next'
import type { FormInputItem } from '../types'

type Props = {
  nodeId: string
  value: string
  onChange: (value: string) => void
  formInputs: FormInputItem[]
  onFormInputsChange: (payload: FormInputItem[]) => void
  onFormInputItemRename: (payload: FormInputItem, oldName: string) => void
  onFormInputItemRemove: (varName: string) => void
  nodeTitle: string
  editorKey: number
}

const FormContent: FC<Props> = ({
  nodeId,
  value,
  onChange,
  formInputs,
  onFormInputsChange,
  onFormInputItemRename,
  onFormInputItemRemove,
  nodeTitle,
  editorKey,
}) => {
  const { t } = useTranslation()
  const filterVar = () => true
  const {
    availableVars,
    availableNodesWithParent: availableNodes,
  } = useAvailableVarList(nodeId, {
    onlyLeafNodeVar: false,
    filterVar,
  })

  const getVarType = useWorkflowVariableType()

  return (
    <div>
      <PromptEditor
        key={editorKey}
        value={value}
        onChange={onChange}
        className='min-h-[80px]'
        hitlInputBlock={{
          show: true,
          formInputs,
          nodeTitle,
          onFormInputsChange,
          onFormInputItemRename,
          onFormInputItemRemove,
        }}
        workflowVariableBlock={{
          show: true,
          variables: availableVars || [],
          getVarType: getVarType as any,
          workflowNodesMap: availableNodes.reduce((acc: any, node) => {
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
          }, {}),
        }}
        editable
      />
    </div>
  )
}
export default React.memo(FormContent)
