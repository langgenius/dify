import React, { memo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useEmbeddedChatbotContext } from '../context'
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
    <div className='space-y-4'>
      {visibleInputsForms.map(form => (
        <div key={form.variable} className='space-y-1'>
          <div className='flex h-6 items-center gap-1'>
            <div className='system-md-semibold text-text-secondary'>{form.label}</div>
            {!form.required && (
              <div className='system-xs-regular text-text-tertiary'>{t('appDebug.variableTable.optional')}</div>
            )}
          </div>
          {form.type === InputVarType.textInput && (
            <Input
              value={inputsFormValue?.[form.variable] || ''}
              onChange={e => handleFormChange(form.variable, e.target.value)}
              placeholder={form.label}
            />
          )}
          {form.type === InputVarType.number && (
            <Input
              type='number'
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
          {form.type === InputVarType.select && (
            <PortalSelect
              popupClassName='w-[200px]'
              value={inputsFormValue?.[form.variable]}
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
        </div>
      ))}
      {showTip && (
        <div className='system-xs-regular text-text-tertiary'>{t('share.chat.chatFormTip')}</div>
      )}
    </div>
  )
}

export default memo(InputsFormContent)
