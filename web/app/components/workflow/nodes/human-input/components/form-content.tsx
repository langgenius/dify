'use client'
import type { FC } from 'react'
import type { FormInputItem } from '../types'
import type { ShortcutPopupInsertHandler } from '@/app/components/base/prompt-editor/plugins/shortcuts-popup-plugin'
import type { WorkflowNodesMap } from '@/app/components/base/prompt-editor/types'
import type { Node, NodeOutPutVar } from '@/app/components/workflow/types'
import { cn } from '@langgenius/dify-ui/cn'
import { Kbd } from '@langgenius/dify-ui/kbd'
import { formatForDisplay } from '@tanstack/react-hotkeys'
import { useBoolean } from 'ahooks'
import * as React from 'react'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import PromptEditor from '@/app/components/base/prompt-editor'
import { INSERT_HITL_INPUT_BLOCK_COMMAND } from '@/app/components/base/prompt-editor/plugins/hitl-input-block'
import { useWorkflowVariableType } from '../../../hooks'
import { BlockEnum } from '../../../types'
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

  const pendingFormInputsRef = useRef<{
    value: string
    formInputs: FormInputItem[]
  } | null>(null)
  const handleInsertHITLNode = useCallback((onInsert: ShortcutPopupInsertHandler) => {
    return (payload: FormInputItem) => {
      if (formInputs.some(input => input.output_variable_name === payload.output_variable_name))
        return

      const newFormInputs = [...(formInputs || []), payload]
      pendingFormInputsRef.current = {
        value,
        formInputs: newFormInputs,
      }
      onInsert(INSERT_HITL_INPUT_BLOCK_COMMAND, {
        variableName: payload.output_variable_name,
        nodeId,
        formInputs: newFormInputs,
        onFormInputsChange,
        onFormInputItemRename,
        onFormInputItemRemove,
      })
    }
  }, [
    formInputs,
    nodeId,
    onFormInputsChange,
    onFormInputItemRemove,
    onFormInputItemRename,
    value,
  ])

  // avoid update formInputs would overwrite the value just inserted
  useEffect(() => {
    const pendingFormInputs = pendingFormInputsRef.current
    if (!pendingFormInputs || pendingFormInputs.value === value)
      return

    onFormInputsChange(pendingFormInputs.formInputs)
    pendingFormInputsRef.current = null
  }, [onFormInputsChange, value])

  const [isFocus, {
    setTrue: setFocus,
    setFalse: setBlur,
  }] = useBoolean(false)

  const workflowNodesMap = availableNodes.reduce<WorkflowNodesMap>((acc, node) => {
    acc[node.id] = {
      title: node.data.title,
      type: node.data.type,
      width: node.width ?? undefined,
      height: node.height ?? undefined,
      position: node.position,
    }
    if (node.data.type === BlockEnum.Start) {
      acc.sys = {
        title: t($ => $['blocks.start'], { ns: 'workflow' }),
        type: BlockEnum.Start,
      }
    }
    return acc
  }, {})
  const unavailableVariableNames = useMemo(() => {
    return formInputs.map(input => input.output_variable_name)
  }, [formInputs])
  const addInputFieldConfigRef = useRef({
    nodeId,
    unavailableVariableNames,
    handleInsertHITLNode,
  })
  addInputFieldConfigRef.current = {
    nodeId,
    unavailableVariableNames,
    handleInsertHITLNode,
  }
  const shortcutPopups = useMemo(() => {
    if (readonly)
      return []

    return [{
      hotkey: ['mod', '/'],
      displayMode: 'workflow-panel-adjacent-center' as const,
      // Keep this component type stable while the popup is open; it reads fresh props from a ref.
      // eslint-disable-next-line react/no-nested-component-definitions
      Popup: ({ onClose, onInsert }: {
        onClose: () => void
        onInsert: ShortcutPopupInsertHandler
      }) => {
        const {
          nodeId,
          unavailableVariableNames,
          handleInsertHITLNode,
        } = addInputFieldConfigRef.current

        return (
          <AddInputField
            nodeId={nodeId}
            unavailableVariableNames={unavailableVariableNames}
            onSave={handleInsertHITLNode(onInsert)}
            onCancel={onClose}
          />
        )
      },
    }]
  }, [readonly])

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
          className={cn('min-h-[80px]', isExpand && 'h-full')}
          onFocus={setFocus}
          onBlur={setBlur}
          placeholder={t($ => $['nodes.humanInput.formContent.placeholder'], { ns: 'workflow' })}
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
            getVarType,
            workflowNodesMap,
          }}
          editable={!readonly}
          shortcutPopups={shortcutPopups}
        />
      </div>
      {isFocus && (
        <div className="flex h-8 shrink-0 items-center px-3 system-xs-regular text-components-input-text-placeholder">
          <Trans
            i18nKey={$ => $["nodes.humanInput.formContent.hotkeyTip"]}
            ns="workflow"
            components={
              {
                Key: <Kbd className="mx-0.5 text-text-placeholder">/</Kbd>,
                CtrlKey: <Kbd className="mx-0.5 text-text-placeholder">{formatForDisplay('Mod')}</Kbd>,
              }
            }
          />
        </div>
      )}
    </div>
  )
}
export default React.memo(FormContent)
