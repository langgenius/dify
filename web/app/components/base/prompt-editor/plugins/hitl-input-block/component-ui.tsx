'use client'
import type { FC } from 'react'
import type { WorkflowNodesMap } from '../workflow-variable-block/node'
import type { FormInputItem } from '@/app/components/workflow/nodes/human-input/types'
import type { Type } from '@/app/components/workflow/nodes/llm/types'
import type { ValueSelector, Var } from '@/app/components/workflow/types'
import { useBoolean } from 'ahooks'
import * as React from 'react'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import {
  createDefaultParagraphFormInput,
  isFileFormInput,
  isParagraphFormInput,
  isSelectFormInput,
} from '@/app/components/workflow/nodes/human-input/types'
import ActionButton from '../../../action-button'
import { VariableX } from '../../../icons/src/vender/workflow'
import Modal from '../../../modal'
import InputField from './input-field'
import VariableBlock from './variable-block'

const i18nPrefix = 'nodes.humanInput.insertInputField'

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
  formInput,
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
  const { t } = useTranslation()
  const resolvedFormInput = formInput || createDefaultParagraphFormInput(varName)
  const paragraphDefault = isParagraphFormInput(resolvedFormInput)
    ? resolvedFormInput.default
    : null
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
  }, [showEditModal])

  const removeBtnRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const removeBtn = removeBtnRef.current
    const removeHandler = () => onRemove(varName)
    if (removeBtn)
      removeBtn.addEventListener('click', removeHandler)

    return () => {
      if (removeBtn)
        removeBtn.removeEventListener('click', removeHandler)
    }
  }, [onRemove, varName])

  const handleChange = useCallback((newPayload: FormInputItem) => {
    if (varName === newPayload.output_variable_name)
      onChange(newPayload)
    else
      onRename(newPayload, varName)
    hideEditModal()
  }, [hideEditModal, onChange, onRename, varName])

  const isDefaultValueVariable = useMemo(() => {
    return paragraphDefault?.type === 'variable'
  }, [paragraphDefault])
  const inputTypeLabel = useMemo(() => {
    if (isParagraphFormInput(resolvedFormInput))
      return t('variableConfig.paragraph', { ns: 'appDebug' })
    if (isSelectFormInput(resolvedFormInput))
      return t('variableConfig.select', { ns: 'appDebug' })
    if (isFileFormInput(resolvedFormInput))
      return t('variableConfig.single-file', { ns: 'appDebug' })
    return t('variableConfig.multi-files', { ns: 'appDebug' })
  }, [resolvedFormInput, t])
  const variableSelector = useMemo(() => {
    if (isDefaultValueVariable)
      return paragraphDefault?.selector || []
    if (isSelectFormInput(resolvedFormInput) && resolvedFormInput.option_source.type === 'variable')
      return resolvedFormInput.option_source.selector
    return null
  }, [isDefaultValueVariable, paragraphDefault?.selector, resolvedFormInput])
  const summaryText = useMemo(() => {
    if (isParagraphFormInput(resolvedFormInput))
      return paragraphDefault?.value || inputTypeLabel

    if (isSelectFormInput(resolvedFormInput)) {
      if (resolvedFormInput.option_source.type === 'variable')
        return t(`${i18nPrefix}.variable`, { ns: 'workflow' })
      return resolvedFormInput.option_source.value.join(', ') || inputTypeLabel
    }

    return inputTypeLabel
  }, [inputTypeLabel, paragraphDefault?.value, resolvedFormInput, t])

  return (
    <div
      className="group relative flex h-8 w-full items-center rounded-lg border-[1.5px] border-components-input-border-active bg-background-default-hover pr-0.5 pl-1.5 select-none"
    >
      <div className="absolute top-[-12px] left-2.5">
        <div className="absolute bottom-1 h-[1.5px] w-full bg-background-default-subtle"></div>
        <div className="relative flex items-center space-x-0.5 px-1 text-text-accent-light-mode-only">
          <VariableX className="size-3" />
          <div className="system-xs-medium">{varName}</div>
        </div>
      </div>

      <div className="flex w-full items-center gap-x-2 pr-5">
        <div className="min-w-0 grow">
          {variableSelector
            ? (
                <VariableBlock
                  variables={variableSelector}
                  workflowNodesMap={workflowNodesMap}
                  getVarType={getVarType}
                  environmentVariables={environmentVariables}
                  conversationVariables={conversationVariables}
                  ragVariables={ragVariables}
                />
              )
            : (
                <div className="max-w-full truncate system-xs-medium text-components-input-text-filled">
                  {summaryText}
                </div>
              )}
        </div>
        <div className="shrink-0 system-2xs-medium text-text-tertiary uppercase">
          {inputTypeLabel}
        </div>

        {/* Actions */}
        {!readonly && (
          <div className="hidden h-full shrink-0 items-center space-x-1 group-hover:flex">
            <div className="flex h-full items-center" ref={editBtnRef}>
              <ActionButton
                size="s"
                data-testid="action-btn-edit"
                aria-label={t('operation.edit', { ns: 'common' })}
              >
                <span className="i-ri-edit-line size-4 text-text-tertiary" />
              </ActionButton>
            </div>

            <div className="flex h-full items-center" ref={removeBtnRef}>
              <ActionButton
                size="s"
                data-testid="action-btn-remove"
                aria-label={t('operation.remove', { ns: 'common' })}
              >
                <span className="i-ri-delete-bin-line size-4 text-text-tertiary" />
              </ActionButton>
            </div>
          </div>
        )}
      </div>

      {isShowEditModal && (
        <Modal
          isShow
          onClose={hideEditModal}
          wrapperClassName="z-999"
          className="max-w-[372px] p-0!"
        >
          <InputField
            nodeId={nodeId}
            isEdit
            payload={resolvedFormInput}
            onChange={handleChange}
            onCancel={hideEditModal}
          />
        </Modal>
      )}
    </div>
  )
}

export default React.memo(HITLInputComponentUI)
