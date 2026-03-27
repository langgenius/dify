import type { ToastPayload } from './variable-modal.helpers'
import type { ConversationVariable } from '@/app/components/workflow/types'
import { RiCloseLine } from '@remixicon/react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import { toast } from '@/app/components/base/ui/toast'
import { ChatVarType } from '@/app/components/workflow/panel/chat-variable-panel/type'
import { useWorkflowStore } from '@/app/components/workflow/store'
import { cn } from '@/utils/classnames'
import { replaceSpaceWithUnderscoreInVarNameInput } from '@/utils/var'
import { useVariableModalState } from './use-variable-modal-state'
import {
  getEditorToggleLabelKey,
  typeList,
  validateVariableName,
} from './variable-modal.helpers'
import {
  DescriptionSection,
  NameSection,
  TypeSection,
  ValueSection,
} from './variable-modal.sections'

export type ModalPropsType = {
  chatVar?: ConversationVariable
  onClose: () => void
  onSave: (chatVar: ConversationVariable) => void
}

const ChatVariableModal = ({
  chatVar,
  onClose,
  onSave,
}: ModalPropsType) => {
  const { t } = useTranslation()
  const workflowStore = useWorkflowStore()
  const notify = React.useCallback(({ children, message, type = 'info' }: ToastPayload) => {
    toast[type](message, children ? { description: children } : undefined)
  }, [])
  const {
    description,
    editInJSON,
    editorContent,
    editorMinHeight,
    handleEditorChange,
    handleEditorValueChange,
    handleSave,
    handleStringOrNumberChange,
    handleTypeChange,
    handleVarNameChange,
    name,
    objectValue,
    placeholder,
    setDescription,
    setObjectValue,
    setValue,
    type,
    value,
  } = useVariableModalState({
    chatVar,
    conversationVariables: workflowStore.getState().conversationVariables,
    notify,
    onClose,
    onSave,
    t,
  })

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    replaceSpaceWithUnderscoreInVarNameInput(e.target)
    if (e.target.value && !validateVariableName({ name: e.target.value, notify, t }))
      return
    handleVarNameChange(e)
  }
  return (
    <div
      className={cn('flex h-full w-[360px] flex-col rounded-2xl border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-2xl', type === ChatVarType.Object && 'w-[480px]')}
    >
      <div className="mb-3 flex shrink-0 items-center justify-between p-4 pb-0 text-text-primary system-xl-semibold">
        {!chatVar ? t('chatVariable.modal.title', { ns: 'workflow' }) : t('chatVariable.modal.editTitle', { ns: 'workflow' })}
        <div className="flex items-center">
          <div
            className="flex h-6 w-6 cursor-pointer items-center justify-center"
            onClick={onClose}
          >
            <RiCloseLine className="h-4 w-4 text-text-tertiary" />
          </div>
        </div>
      </div>
      <div className="max-h-[480px] overflow-y-auto px-4 py-2">
        <NameSection
          name={name}
          onBlur={nextName => validateVariableName({ name: nextName, notify, t })}
          onChange={handleNameChange}
          placeholder={t('chatVariable.modal.namePlaceholder', { ns: 'workflow' }) || ''}
          title={t('chatVariable.modal.name', { ns: 'workflow' })}
        />
        <TypeSection
          type={type}
          list={typeList}
          onSelect={handleTypeChange}
          title={t('chatVariable.modal.type', { ns: 'workflow' })}
        />
        <ValueSection
          type={type}
          value={value}
          objectValue={objectValue}
          editInJSON={editInJSON}
          editorContent={editorContent}
          editorMinHeight={editorMinHeight}
          onArrayBoolChange={setValue}
          onArrayChange={type === ChatVarType.String || type === ChatVarType.Number ? handleStringOrNumberChange : setValue}
          onEditorChange={handleEditorChange}
          onEditorValueChange={handleEditorValueChange}
          onObjectChange={setObjectValue}
          onValueChange={setValue}
          placeholder={placeholder}
          t={t}
          toggleLabelKey={
            type === ChatVarType.Object
            || type === ChatVarType.ArrayString
            || type === ChatVarType.ArrayNumber
            || type === ChatVarType.ArrayBoolean
              ? getEditorToggleLabelKey(type, editInJSON)
              : undefined
          }
        />
        <DescriptionSection
          description={description}
          onChange={setDescription}
          placeholder={t('chatVariable.modal.descriptionPlaceholder', { ns: 'workflow' }) || ''}
          title={t('chatVariable.modal.description', { ns: 'workflow' })}
        />
      </div>
      <div className="flex flex-row-reverse rounded-b-2xl p-4 pt-2">
        <div className="flex gap-2">
          <Button onClick={onClose}>{t('operation.cancel', { ns: 'common' })}</Button>
          <Button variant="primary" onClick={handleSave}>{t('operation.save', { ns: 'common' })}</Button>
        </div>
      </div>
    </div>
  )
}

export default ChatVariableModal
