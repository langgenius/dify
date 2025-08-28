'use client'
import PromptEditor from '@/app/components/base/prompt-editor'
import type { FC } from 'react'
import React, { useEffect, useState } from 'react'
import useAvailableVarList from '../../_base/hooks/use-available-var-list'
import { BlockEnum } from '../../../types'
import { useWorkflowVariableType } from '../../../hooks'
import { useTranslation } from 'react-i18next'
import type { FormInputItem } from '../types'
import AddInputField from './add-input-field'
import { INSERT_HITL_INPUT_BLOCK_COMMAND } from '@/app/components/base/prompt-editor/plugins/hitl-input-block'
import type { LexicalCommand } from 'lexical'
import { isMac } from '../../../utils'
import { useBoolean } from 'ahooks'
import cn from '@/utils/classnames'

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

  const [needToAddFormInput, setNeedToAddFormInput] = useState(false)
  const [newFormInputs, setNewFormInputs] = useState<FormInputItem[]>([])
  const handleInsertHITLNode = (onInsert: (command: LexicalCommand<unknown>, params: any) => void) => {
    return (payload: FormInputItem) => {
      const newFormInputs = [...(formInputs || []), payload]
      onInsert(INSERT_HITL_INPUT_BLOCK_COMMAND, {
        variableName: payload.output_variable_name,
        nodeId,
        nodeTitle,
        formInputs: newFormInputs,
        onFormInputsChange,
        onFormInputItemRename,
        onFormInputItemRemove,
      })
      setNewFormInputs(newFormInputs)
      setNeedToAddFormInput(true)
    }
  }

  // avoid update formInputs would overwrite the value just inserted
  useEffect(() => {
    if (needToAddFormInput) {
      onFormInputsChange(newFormInputs)
      setNeedToAddFormInput(false)
    }
  }, [value])

  const [isFocus, {
    setTrue: setFocus,
    setFalse: setBlur,
  }] = useBoolean(false)

  return (
    <div className={cn('rounded-[10px] border border-components-input-bg-normal bg-components-input-bg-normal px-3 pt-1', isFocus && 'border-components-input-border-active bg-components-input-bg-active')}>
      <PromptEditor
        key={editorKey}
        value={value}
        onChange={onChange}
        className='min-h-[80px]'
        onFocus={setFocus}
        onBlur={setBlur}
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
      <div className='system-xs-regular flex h-8 items-center text-components-input-text-placeholder'>Press / to insert variable, {isMac() ? '⌘' : 'Ctrl'} / to insert input field</div>
    </div>
  )
}
export default React.memo(FormContent)
