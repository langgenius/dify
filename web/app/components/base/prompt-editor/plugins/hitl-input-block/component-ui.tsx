'use client'
import type { FC } from 'react'
import type { WorkflowNodesMap } from '../workflow-variable-block/node'
import type { FormInputItem } from '@/app/components/workflow/nodes/human-input/types'
import type { Type } from '@/app/components/workflow/nodes/llm/types'
import type { ValueSelector, Var } from '@/app/components/workflow/types'
import { RiDeleteBinLine, RiEditLine } from '@remixicon/react'
import { useBoolean } from 'ahooks'
import * as React from 'react'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { InputVarType } from '@/app/components/workflow/types'
import ActionButton from '../../../action-button'
import { VariableX } from '../../../icons/src/vender/workflow'
import Modal from '../../../modal'
import InputField from './input-field'
import VariableBlock from './variable-block'

type HITLInputComponentUIProps = {
  nodeId: string
  varName: string
  formInput?: FormInputItem
  onChange: (input: FormInputItem) => void
  onRename: (payload: FormInputItem, oldName: string) => void
  onRemove: (varName: string) => void
  workflowNodesMap: WorkflowNodesMap
  environmentVariables?: Var[]
  conversationVariables?: Var[]
  ragVariables?: Var[]
  getVarType?: (payload: {
    nodeId: string
    valueSelector: ValueSelector
  }) => Type
  readonly?: boolean
}

const HITLInputComponentUI: FC<HITLInputComponentUIProps> = ({
  nodeId,
  varName,
  formInput = {
    type: InputVarType.paragraph,
    output_variable_name: varName,
    placeholder: {
      type: 'constant',
      selector: [],
      value: '',
    },
  },
  onChange,
  onRename,
  onRemove,
  workflowNodesMap = {},
  getVarType,
  environmentVariables,
  conversationVariables,
  ragVariables,
  readonly,
}) => {
  const [isShowEditModal, {
    setTrue: showEditModal,
    setFalse: hideEditModal,
  }] = useBoolean(false)

  // Lexical delegate the click make it unable to add click by the method of react
  const editBtnRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const editBtn = editBtnRef.current
    if (editBtn)
      editBtn.addEventListener('click', showEditModal)

    return () => {
      if (editBtn)
        editBtn.removeEventListener('click', showEditModal)
    }
  }, [])

  const removeBtnRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const removeBtn = removeBtnRef.current
    if (removeBtn)
      removeBtn.addEventListener('click', () => onRemove(varName))

    return () => {
      if (removeBtn)
        removeBtn.removeEventListener('click', () => onRemove(varName))
    }
  }, [onRemove, varName])

  const handleChange = useCallback((newPayload: FormInputItem) => {
    if (varName === newPayload.output_variable_name)
      onChange(newPayload)
    else
      onRename(newPayload, varName)
    hideEditModal()
  }, [hideEditModal, onChange, onRename, varName])

  const isPlaceholderVariable = useMemo(() => {
    return formInput.placeholder.type === 'variable'
  }, [formInput.placeholder.type])

  return (
    <div
      className="group relative flex h-8 w-full select-none items-center rounded-[8px] border-[1.5px] border-components-input-border-active bg-background-default-hover pl-1.5 pr-0.5"
    >
      <div className="absolute left-2.5 top-[-12px]">
        <div className="absolute bottom-1 h-[1.5px] w-full bg-background-default-subtle"></div>
        <div className="relative flex items-center space-x-0.5 px-1 text-text-accent-light-mode-only">
          <VariableX className="size-3" />
          <div className="system-xs-medium">{varName}</div>
        </div>
      </div>

      <div className="flex w-full items-center gap-x-0.5">
        <div className="grow">
          {/* Placeholder Info */}
          {isPlaceholderVariable && (
            <VariableBlock
              variables={formInput.placeholder.selector}
              workflowNodesMap={workflowNodesMap}
              getVarType={getVarType}
              environmentVariables={environmentVariables}
              conversationVariables={conversationVariables}
              ragVariables={ragVariables}
            />
          )}
          {!isPlaceholderVariable && (
            <div className="system-xs-medium text-text-quaternary">{formInput.placeholder.value}</div>
          )}
        </div>

        {/* Actions */}
        {!readonly && (
          <div className="hidden h-full shrink-0 items-center space-x-1 pr-8 group-hover:flex">
            <div className="flex h-full items-center" ref={editBtnRef}>
              <ActionButton size="s">
                <RiEditLine className="size-4 text-text-tertiary" />
              </ActionButton>
            </div>

            <div className="flex h-full items-center" ref={removeBtnRef}>
              <ActionButton size="s">
                <RiDeleteBinLine className="size-4 text-text-tertiary" />
              </ActionButton>
            </div>
          </div>
        )}
      </div>

      {isShowEditModal && (
        <Modal
          isShow
          onClose={hideEditModal}
          wrapperClassName="z-[999]"
          className="max-w-[372px] !p-0"
        >
          <InputField
            nodeId={nodeId}
            isEdit
            payload={formInput}
            onChange={handleChange}
            onCancel={hideEditModal}
          />
        </Modal>
      )}
    </div>
  )
}

export default React.memo(HITLInputComponentUI)
