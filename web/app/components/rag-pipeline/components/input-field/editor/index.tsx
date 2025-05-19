import { RiCloseLine } from '@remixicon/react'
import DialogWrapper from '../dialog-wrapper'
import InputFieldForm from './form'
import { convertToInputFieldFormData } from './utils'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import type { InputVar } from '@/models/pipeline'
import type { FormData } from './form/types'

type InputFieldEditorProps = {
  show: boolean
  onClose: () => void
  onSubmit: (data: InputVar) => void
  initialData?: InputVar
}

const InputFieldEditor = ({
  show,
  onClose,
  onSubmit,
  initialData,
}: InputFieldEditorProps) => {
  const { t } = useTranslation()
  const formData = convertToInputFieldFormData(initialData)

  const handleSubmit = useCallback((value: FormData) => {
    const {
      type,
      label,
      variable,
      maxLength,
      required,
      tooltips,
      options,
      placeholder,
      unit,
      default: defaultValue,
      allowedFileUploadMethods,
      allowedTypesAndExtensions,
    } = value
    onSubmit({
      type,
      label,
      variable,
      max_length: maxLength,
      required,
      tooltips,
      options,
      placeholder,
      unit,
      default: defaultValue,
      allowed_file_upload_methods: allowedFileUploadMethods,
      allowed_file_types: allowedTypesAndExtensions.allowedFileTypes,
      allowed_file_extensions: allowedTypesAndExtensions.allowedFileExtensions,
    })
    onClose()
  }, [onSubmit, onClose])

  return (
    <DialogWrapper
      show={show}
      onClose={onClose}
      panelWrapperClassName='pr-[424px] justify-start'
      className='w-[400px] grow-0 rounded-2xl border-[0.5px] bg-components-panel-bg shadow-shadow-shadow-9'
    >
      <div className='relative flex h-fit flex-col'>
        <div className='system-xl-semibold flex items-center pb-1 pl-4 pr-11 pt-3.5 text-text-primary'>
          {initialData ? t('datasetPipeline.inputFieldPanel.editInputField') : t('datasetPipeline.inputFieldPanel.addInputField')}
        </div>
        <button
          type='button'
          className='absolute right-2.5 top-2.5 flex size-8 items-center justify-center'
          onClick={onClose}
        >
          <RiCloseLine className='size-4 text-text-tertiary' />
        </button>
        <InputFieldForm
          initialData={formData}
          supportFile
          onCancel={onClose}
          onSubmit={handleSubmit}
        />
      </div>
    </DialogWrapper>
  )
}

export default InputFieldEditor
