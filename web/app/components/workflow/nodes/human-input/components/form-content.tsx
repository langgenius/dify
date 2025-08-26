'use client'
import PromptEditor from '@/app/components/base/prompt-editor'
import type { FC } from 'react'
import React from 'react'
import useAvailableVarList from '../../_base/hooks/use-available-var-list'
import { BlockEnum } from '../../../types'
import { useWorkflowVariableType } from '../../../hooks'
import { useTranslation } from 'react-i18next'
import type { FormInputItem } from '../types'
import AddInputField from './add-input-field'
import { INSERT_HITL_INPUT_BLOCK_COMMAND } from '@/app/components/base/prompt-editor/plugins/hitl-input-block'
import type { LexicalCommand } from 'lexical'

type Props = {
  nodeId: string
  nodeTitle: string
  value: string
  onChange: (value: string) => void
  formInputs: FormInputItem[]
  onFormInputsChange: (payload: FormInputItem[]) => void
  onFormInputItemRename: (payload: FormInputItem, oldName: string) => void
  onFormInputItemRemove: (varName: string) => void
  editorKey: number
}

const FormContent: FC<Props> = ({
  nodeId,
  nodeTitle,
  value,
  onChange,
  formInputs,
  onFormInputsChange,
  onFormInputItemRename,
  onFormInputItemRemove,
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

  const handleInsertHITLNode = (onInsert: (command: LexicalCommand<unknown>, params: any) => void) => {
    return (payload: FormInputItem) => {
      // todo insert into form inputs
      onInsert(INSERT_HITL_INPUT_BLOCK_COMMAND, {
        variableName: payload.output_variable_name,
        nodeId,
        nodeTitle,
        formInputs,
        onFormInputsChange,
        onFormInputItemRename,
        onFormInputItemRemove,
      })
    }
  }

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
          nodeId,
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
        shortcutPopups={[{
          hotkey: ['mod', '/'],
          Popup: ({ onClose, onInsert }) => (
            <AddInputField
              nodeId={nodeId}
              onSave={handleInsertHITLNode(onInsert!)}
              onCancel={onClose}
            />
          ),
        }]}
      />
    </div>
  )
}
export default React.memo(FormContent)
