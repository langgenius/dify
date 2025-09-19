import { useTranslation } from 'react-i18next'
import { useCallback, useState } from 'react'
import type { MoreInfo } from '@/app/components/workflow/types'
import { ChangeType } from '@/app/components/workflow/types'
import { useFileUploadConfig } from '@/service/use-common'
import type { FormData, InputFieldFormProps } from './types'
import { useAppForm } from '@/app/components/base/form'
import { createInputFieldSchema } from './schema'
import Toast from '@/app/components/base/toast'
import { useFileSizeLimit } from '@/app/components/base/file-uploader/hooks'
import Divider from '@/app/components/base/divider'
import ShowAllSettings from './show-all-settings'
import Button from '@/app/components/base/button'
import InitialFields from './initial-fields'
import HiddenFields from './hidden-fields'

const InputFieldForm = ({
  initialData,
  supportFile = false,
  onCancel,
  onSubmit,
  isEditMode = true,
}: InputFieldFormProps) => {
  const { t } = useTranslation()

  const { data: fileUploadConfigResponse } = useFileUploadConfig()
  const {
    maxFileUploadLimit,
  } = useFileSizeLimit(fileUploadConfigResponse)

  const inputFieldForm = useAppForm({
    defaultValues: initialData,
    validators: {
      onSubmit: ({ value }) => {
        const { type } = value
        const schema = createInputFieldSchema(type, t, { maxFileUploadLimit })
        const result = schema.safeParse(value)
        if (!result.success) {
          const issues = result.error.issues
          const firstIssue = issues[0]
          const errorMessage = `"${firstIssue.path.join('.')}" ${firstIssue.message}`
          Toast.notify({
            type: 'error',
            message: errorMessage,
          })
          return errorMessage
        }
        return undefined
      },
    },
    onSubmit: ({ value }) => {
      let moreInfo: MoreInfo | undefined
      if (isEditMode && value.variable !== initialData?.variable) {
        moreInfo = {
          type: ChangeType.changeVarName,
          payload: { beforeKey: initialData?.variable || '', afterKey: value.variable },
        }
      }
      onSubmit(value as FormData, moreInfo)
    },
  })

  const [showAllSettings, setShowAllSettings] = useState(false)

  const InitialFieldsComp = InitialFields({
    initialData,
    supportFile,
  })
  const HiddenFieldsComp = HiddenFields({
    initialData,
  })

  const handleShowAllSettings = useCallback(() => {
    setShowAllSettings(true)
  }, [])

  const ShowAllSettingComp = ShowAllSettings({
    initialData,
    handleShowAllSettings,
  })

  return (
    <form
      className='w-full'
      onSubmit={(e) => {
        e.preventDefault()
        e.stopPropagation()
        inputFieldForm.handleSubmit()
      }}
    >
      <div className='flex flex-col gap-4 px-4 py-2'>
        <InitialFieldsComp form={inputFieldForm} />
        <Divider type='horizontal' />
        {!showAllSettings && (
          <ShowAllSettingComp form={inputFieldForm} />
        )}
        {showAllSettings && (
          <HiddenFieldsComp form={inputFieldForm} />
        )}
      </div>
      <div className='flex items-center justify-end gap-x-2 p-4 pt-2'>
        <Button variant='secondary' onClick={onCancel}>
          {t('common.operation.cancel')}
        </Button>
        <inputFieldForm.AppForm>
          <inputFieldForm.Actions />
        </inputFieldForm.AppForm>
      </div>
    </form>
  )
}

export default InputFieldForm
