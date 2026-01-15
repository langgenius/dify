import * as React from 'react'
import { memo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { FileUploaderInAttachmentWrapper } from '@/app/components/base/file-uploader'
import Input from '@/app/components/base/input'
import { PortalSelect } from '@/app/components/base/select'
import Textarea from '@/app/components/base/textarea'
import BoolInput from '@/app/components/workflow/nodes/_base/components/before-run-form/bool-input'
import CodeEditor from '@/app/components/workflow/nodes/_base/components/editor/code-editor'
import { CodeLanguage } from '@/app/components/workflow/nodes/code/types'
import { InputVarType } from '@/app/components/workflow/types'
import { useEmbeddedChatbotContext } from '../context'

type Props = {
  showTip?: boolean
}

const InputsFormContent = ({ showTip }: Props) => {
  const { t } = useTranslation()
  const {
    appParams,
    inputsForms,
    currentConversationId,
    currentConversationInputs,
    setCurrentConversationInputs,
    newConversationInputs,
    newConversationInputsRef,
    handleNewConversationInputsChange,
  } = useEmbeddedChatbotContext()
  const inputsFormValue = currentConversationId ? currentConversationInputs : newConversationInputs

  const handleFormChange = useCallback((variable: string, value: any) => {
    setCurrentConversationInputs({
      ...currentConversationInputs,
      [variable]: value,
    })
    handleNewConversationInputsChange({
      ...newConversationInputsRef.current,
      [variable]: value,
    })
  }, [newConversationInputsRef, handleNewConversationInputsChange, currentConversationInputs, setCurrentConversationInputs])

  const visibleInputsForms = inputsForms.filter(form => form.hide !== true)

  return (
    <div className="space-y-4">
      {visibleInputsForms.map(form => (
        <div key={form.variable} className="space-y-1">
          {form.type !== InputVarType.checkbox && (
            <div className="flex h-6 items-center gap-1">
              <div className="system-md-semibold text-text-secondary">{form.label}</div>
              {!form.required && (
                <div className="system-xs-regular text-text-tertiary">{t('panel.optional', { ns: 'workflow' })}</div>
              )}
            </div>
          )}
          {form.type === InputVarType.textInput && (
            <Input
              value={inputsFormValue?.[form.variable] || ''}
              onChange={e => handleFormChange(form.variable, e.target.value)}
              placeholder={form.label}
            />
          )}
          {form.type === InputVarType.number && (
            <Input
              type="number"
              value={inputsFormValue?.[form.variable] || ''}
              onChange={e => handleFormChange(form.variable, e.target.value)}
              placeholder={form.label}
            />
          )}
          {form.type === InputVarType.paragraph && (
            <Textarea
              value={inputsFormValue?.[form.variable] || ''}
              onChange={e => handleFormChange(form.variable, e.target.value)}
              placeholder={form.label}
            />
          )}
          {form.type === InputVarType.checkbox && (
            <BoolInput
              name={form.label}
              value={inputsFormValue?.[form.variable]}
              required={form.required}
              onChange={value => handleFormChange(form.variable, value)}
            />
          )}
          {form.type === InputVarType.select && (
            <PortalSelect
              popupClassName="w-[200px]"
              value={inputsFormValue?.[form.variable] ?? form.default ?? ''}
              items={form.options.map((option: string) => ({ value: option, name: option }))}
              onSelect={item => handleFormChange(form.variable, item.value as string)}
              placeholder={form.label}
            />
          )}
          {form.type === InputVarType.singleFile && (
            <FileUploaderInAttachmentWrapper
              value={inputsFormValue?.[form.variable] ? [inputsFormValue?.[form.variable]] : []}
              onChange={files => handleFormChange(form.variable, files[0])}
              fileConfig={{
                allowed_file_types: form.allowed_file_types,
                allowed_file_extensions: form.allowed_file_extensions,
                allowed_file_upload_methods: form.allowed_file_upload_methods,
                number_limits: 1,
                fileUploadConfig: (appParams as any).system_parameters,
              }}
            />
          )}
          {form.type === InputVarType.multiFiles && (
            <FileUploaderInAttachmentWrapper
              value={inputsFormValue?.[form.variable] || []}
              onChange={files => handleFormChange(form.variable, files)}
              fileConfig={{
                allowed_file_types: form.allowed_file_types,
                allowed_file_extensions: form.allowed_file_extensions,
                allowed_file_upload_methods: form.allowed_file_upload_methods,
                number_limits: form.max_length,
                fileUploadConfig: (appParams as any).system_parameters,
              }}
            />
          )}
          {form.type === InputVarType.jsonObject && (
            <CodeEditor
              language={CodeLanguage.json}
              value={inputsFormValue?.[form.variable] || ''}
              onChange={v => handleFormChange(form.variable, v)}
              noWrapper
              className="bg h-[80px] overflow-y-auto rounded-[10px] bg-components-input-bg-normal p-1"
              placeholder={
                <div className="whitespace-pre">{form.json_schema}</div>
              }
            />
          )}
        </div>
      ))}
      {showTip && (
        <div className="system-xs-regular text-text-tertiary">{t('chat.chatFormTip', { ns: 'share' })}</div>
      )}
    </div>
  )
}

export default memo(InputsFormContent)
