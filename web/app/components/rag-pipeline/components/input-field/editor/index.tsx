import { RiCloseLine } from '@remixicon/react'
import DialogWrapper from '../dialog-wrapper'
import InputFieldForm from './form'
import { convertFormDataToINputField, convertToInputFieldFormData } from './utils'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import type { InputVar } from '@/models/pipeline'
import type { FormData } from './form/types'
import type { MoreInfo } from '@/app/components/workflow/types'

type InputFieldEditorProps = {
  show: boolean
  onClose: () => void
  onSubmit: (data: InputVar, moreInfo?: MoreInfo) => void
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

  const handleSubmit = useCallback((value: FormData, moreInfo?: MoreInfo) => {
    const inputFieldData = convertFormDataToINputField(value)
    onSubmit(inputFieldData, moreInfo)
  }, [onSubmit])

  return (
    <DialogWrapper
      show={show}
      onClose={onClose}
      outerWrapperClassName='overflow-y-auto'
      panelWrapperClassName='pr-[424px] justify-start'
      className='w-[400px] rounded-2xl border-[0.5px] bg-components-panel-bg shadow-shadow-shadow-9'
    >
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
    </DialogWrapper>
  )
}

export default InputFieldEditor
