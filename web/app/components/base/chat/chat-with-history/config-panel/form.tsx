import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useChatWithHistoryContext } from '../context'
import Input from './form-input'
import { PortalSelect } from '@/app/components/base/select'
import { InputVarType } from '@/app/components/workflow/types'
import { FileUploaderInAttachmentWrapper } from '@/app/components/base/file-uploader'

const Form = () => {
  const { t } = useTranslation()
  const {
    appParams,
    inputsForms,
    newConversationInputs,
    newConversationInputsRef,
    handleNewConversationInputsChange,
    isMobile,
  } = useChatWithHistoryContext()

  const handleFormChange = useCallback((variable: string, value: any) => {
    handleNewConversationInputsChange({
      ...newConversationInputsRef.current,
      [variable]: value,
    })
  }, [newConversationInputsRef, handleNewConversationInputsChange])

  const renderField = (form: any) => {
    const {
      label,
      required,
      variable,
      options,
    } = form

    if (form.type === 'text-input' || form.type === 'paragraph') {
      return (
        <Input
          form={form}
          value={newConversationInputs[variable]}
          onChange={handleFormChange}
        />
      )
    }
    if (form.type === 'number') {
      return (
        <input
          className="h-9 grow appearance-none rounded-lg bg-gray-100 px-2.5 outline-none"
          type="number"
          value={newConversationInputs[variable] || ''}
          onChange={e => handleFormChange(variable, e.target.value)}
          placeholder={`${label}${!required ? `(${t('appDebug.variableTable.optional')})` : ''}`}
        />
      )
    }
    if (form.type === InputVarType.singleFile) {
      return (
        <FileUploaderInAttachmentWrapper
          value={newConversationInputs[variable] ? [newConversationInputs[variable]] : []}
          onChange={files => handleFormChange(variable, files[0])}
          fileConfig={{
            allowed_file_types: form.allowed_file_types,
            allowed_file_extensions: form.allowed_file_extensions,
            allowed_file_upload_methods: form.allowed_file_upload_methods,
            number_limits: 1,
            fileUploadConfig: (appParams as any).system_parameters,
          }}
        />
      )
    }
    if (form.type === InputVarType.multiFiles) {
      return (
        <FileUploaderInAttachmentWrapper
          value={newConversationInputs[variable]}
          onChange={files => handleFormChange(variable, files)}
          fileConfig={{
            allowed_file_types: form.allowed_file_types,
            allowed_file_extensions: form.allowed_file_extensions,
            allowed_file_upload_methods: form.allowed_file_upload_methods,
            number_limits: form.max_length,
            fileUploadConfig: (appParams as any).system_parameters,
          }}
        />
      )
    }

    return (
      <PortalSelect
        popupClassName='w-[200px]'
        value={newConversationInputs[variable]}
        items={options.map((option: string) => ({ value: option, name: option }))}
        onSelect={item => handleFormChange(variable, item.value as string)}
        placeholder={`${label}${!required ? `(${t('appDebug.variableTable.optional')})` : ''}`}
      />
    )
  }

  if (!inputsForms.length)
    return null

  return (
    <div className='mb-4 py-2'>
      {
        inputsForms.map(form => (
          <div
            key={form.variable}
            className={`mb-3 flex text-sm text-gray-900 last-of-type:mb-0 ${isMobile && '!flex-wrap'}`}
          >
            <div className={`mr-2 w-[128px] shrink-0 py-2 ${isMobile && '!w-full'}`}>{form.label}</div>
            {renderField(form)}
          </div>
        ))
      }
    </div>
  )
}

export default Form
