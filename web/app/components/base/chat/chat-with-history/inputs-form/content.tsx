import React, { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useChatWithHistoryContext } from '../context'
import Input from '@/app/components/base/input'
import Textarea from '@/app/components/base/textarea'
import { PortalSelect } from '@/app/components/base/select'
import { FileUploaderInAttachmentWrapper } from '@/app/components/base/file-uploader'
import { InputVarType } from '@/app/components/workflow/types'

type Props = {
  showTip?: boolean
}

const InputsFormContent = ({ showTip }: Props) => {
  const { t } = useTranslation()
  const {
    appParams,
    inputsForms,
    currentConversationId,
    currentConversationItem,
    newConversationInputs,
    newConversationInputsRef,
    handleNewConversationInputsChange,
  } = useChatWithHistoryContext()
  const inputsFormValue = currentConversationId ? currentConversationItem?.inputs : newConversationInputs
  const readonly = !!currentConversationId

  const handleFormChange = useCallback((variable: string, value: any) => {
    handleNewConversationInputsChange({
      ...newConversationInputsRef.current,
      [variable]: value,
    })
  }, [newConversationInputsRef, handleNewConversationInputsChange])

  return (
    <div className='space-y-4'>
      {inputsForms.map(form => (
        <div key={form.variable} className='space-y-1'>
          <div className='h-6 flex items-center gap-1'>
            <div className='text-text-secondary system-md-semibold'>{form.label}</div>
            {!form.required && (
              <div className='text-text-tertiary system-xs-regular'>{t('appDebug.variableTable.optional')}</div>
            )}
          </div>
          {form.type === InputVarType.textInput && (
            <Input
              value={inputsFormValue?.[form.variable] || ''}
              onChange={e => handleFormChange(form.variable, e.target.value)}
              placeholder={form.label}
              readOnly={readonly}
              disabled={readonly}
            />
          )}
          {form.type === InputVarType.number && (
            <Input
              type='number'
              value={inputsFormValue?.[form.variable] || ''}
              onChange={e => handleFormChange(form.variable, e.target.value)}
              placeholder={form.label}
              readOnly={readonly}
              disabled={readonly}
            />
          )}
          {form.type === InputVarType.paragraph && (
            <Textarea
              value={inputsFormValue?.[form.variable] || ''}
              onChange={e => handleFormChange(form.variable, e.target.value)}
              placeholder={form.label}
              readOnly={readonly}
              disabled={readonly}
            />
          )}
          {form.type === InputVarType.select && (
            <PortalSelect
              popupClassName='w-[200px]'
              value={inputsFormValue?.[form.variable]}
              items={form.options.map((option: string) => ({ value: option, name: option }))}
              onSelect={item => handleFormChange(form.variable, item.value as string)}
              placeholder={form.label}
              readonly={readonly}
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
        </div>
      ))}
      {showTip && (
        <div className='text-text-tertiary system-xs-regular'>{t('share.chat.chatFormTip')}</div>
      )}
    </div>
  )
}

export default InputsFormContent
