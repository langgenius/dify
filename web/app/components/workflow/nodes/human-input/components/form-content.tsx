'use client'
import type { LexicalCommand } from 'lexical'
import type { FC } from 'react'
import type { FormInputItem } from '../types'
import type { Node, NodeOutPutVar } from '@/app/components/workflow/types'
import { useBoolean } from 'ahooks'
import * as React from 'react'
import { useEffect, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import PromptEditor from '@/app/components/base/prompt-editor'
import { INSERT_HITL_INPUT_BLOCK_COMMAND } from '@/app/components/base/prompt-editor/plugins/hitl-input-block'
import { cn } from '@/utils/classnames'
import { useWorkflowVariableType } from '../../../hooks'
import { BlockEnum } from '../../../types'
import { isMac } from '../../../utils'
import AddInputField from './add-input-field'

type FormContentProps = {
  nodeId: string
  value: string
  onChange: (value: string) => void
  formInputs: FormInputItem[]
  onFormInputsChange: (payload: FormInputItem[]) => void
  onFormInputItemRename: (payload: FormInputItem, oldName: string) => void
  onFormInputItemRemove: (varName: string) => void
  editorKey: number
  isExpand: boolean
  availableVars: NodeOutPutVar[]
  availableNodes: Node[]
  readonly?: boolean
}

const Key: FC<{ children: React.ReactNode, className?: string }> = ({ children, className }) => {
  return <span className={cn('system-kbd mx-0.5 inline-flex size-4 items-center justify-center rounded-[4px] bg-components-kbd-bg-gray text-text-placeholder ', className)}>{children}</span>
}

const CtrlKey: FC = () => {
  return <Key className={cn('mr-0', !isMac() && 'w-7')}>{isMac() ? '⌘' : 'Ctrl'}</Key>
}

const FormContent: FC<FormContentProps> = ({
  nodeId,
  value,
  onChange,
  formInputs,
  onFormInputsChange,
  onFormInputItemRename,
  onFormInputItemRemove,
  editorKey,
  isExpand,
  availableVars,
  availableNodes,
  readonly,
}) => {
  const { t } = useTranslation()

  const getVarType = useWorkflowVariableType()

  const [needToAddFormInput, setNeedToAddFormInput] = useState(false)
  const [newFormInputs, setNewFormInputs] = useState<FormInputItem[]>([])
  const handleInsertHITLNode = (onInsert: (command: LexicalCommand<unknown>, params: any) => void) => {
    return (payload: FormInputItem) => {
      const newFormInputs = [...(formInputs || []), payload]
      onInsert(INSERT_HITL_INPUT_BLOCK_COMMAND, {
        variableName: payload.output_variable_name,
        nodeId,
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

  const workflowNodesMap = availableNodes.reduce((acc: any, node) => {
    acc[node.id] = {
      title: node.data.title,
      type: node.data.type,
      width: node.width,
      height: node.height,
      position: node.position,
    }
    if (node.data.type === BlockEnum.Start) {
      acc.sys = {
        title: t('blocks.start', { ns: 'workflow' }),
        type: BlockEnum.Start,
      }
    }
    return acc
  }, {})

  return (
    <div
      className={cn(
        'flex grow flex-col rounded-[10px] border border-components-input-bg-normal bg-components-input-bg-normal pt-1',
        isFocus && 'border-components-input-border-active bg-components-input-bg-active',
        !isFocus && 'pb-[32px]',
        readonly && 'pointer-events-none',
      )}
    >
      <div className={cn('max-h-[300px] overflow-y-auto px-3', isExpand && 'h-0 max-h-full grow')}>
        <PromptEditor
          key={editorKey}
          value={value}
          onChange={onChange}
          className={cn('min-h-[80px] ', isExpand && 'h-full')}
          onFocus={setFocus}
          onBlur={setBlur}
          placeholder={t('nodes.humanInput.formContent.placeholder', { ns: 'workflow' })}
          hitlInputBlock={{
            show: true,
            formInputs,
            nodeId,
            onFormInputsChange,
            onFormInputItemRename,
            onFormInputItemRemove,
            variables: availableVars || [],
            workflowNodesMap,
            getVarType,
            readonly,
          }}
          workflowVariableBlock={{
            show: true,
            variables: availableVars || [],
            getVarType: getVarType as any,
            workflowNodesMap,
          }}
          editable={!readonly}
          shortcutPopups={readonly
            ? []
            : [{
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
      {isFocus && (
        <div className="system-xs-regular flex h-8 shrink-0 items-center px-3 text-components-input-text-placeholder">
          <Trans
            i18nKey="nodes.humanInput.formContent.hotkeyTip"
            ns="workflow"
            components={
              {
                Key: <Key>/</Key>,
                CtrlKey: <CtrlKey />,
              }
            }
          />
        </div>
      )}
    </div>
  )
}
export default React.memo(FormContent)
