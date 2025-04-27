import { useTranslation } from 'react-i18next'
import { useCallback, useState } from 'react'
import type { DeepKeys } from '@tanstack/react-form'
import { useStore } from '@tanstack/react-form'
import { ChangeType } from '@/app/components/workflow/types'
import { useFileUploadConfig } from '@/service/use-common'
import type { FormData, InputFieldFormProps } from './types'
import { useAppForm } from '@/app/components/base/form'
import { createInputFieldSchema } from './schema'
import Toast from '@/app/components/base/toast'
import { useFileSizeLimit } from '@/app/components/base/file-uploader/hooks'
import { useConfigurations, useHiddenFieldNames } from './hooks'
import Divider from '@/app/components/base/divider'
import ShowAllSettings from './show-all-settings'
import Button from '@/app/components/base/button'
import InputField from '@/app/components/base/form/form-scenarios/input-field/field'

const InputFieldForm = ({
  initialData,
  supportFile = false,
  onCancel,
  onSubmit,
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
          const firstIssue = issues[0].message
          Toast.notify({
            type: 'error',
            message: firstIssue,
          })
          return firstIssue
        }
        return undefined
      },
    },
    onSubmit: ({ value }) => {
      const moreInfo = value.variable === initialData?.variable
        ? undefined
        : {
          type: ChangeType.changeVarName,
          payload: { beforeKey: initialData?.variable || '', afterKey: value.variable },
        }
      onSubmit(value, moreInfo)
    },
  })

  const [showAllSettings, setShowAllSettings] = useState(false)
  const type = useStore(inputFieldForm.store, state => state.values.type)
  const options = useStore(inputFieldForm.store, state => state.values.options)

  const setFieldValue = useCallback((fieldName: DeepKeys<FormData>, value: any) => {
    inputFieldForm.setFieldValue(fieldName, value)
  }, [inputFieldForm])

  const hiddenFieldNames = useHiddenFieldNames(type)
  const { initialConfigurations, hiddenConfigurations } = useConfigurations({
    type,
    options,
    setFieldValue,
    supportFile,
  })

  const handleShowAllSettings = useCallback(() => {
    setShowAllSettings(true)
  }, [])

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
        {initialConfigurations.map((config, index) => {
          const FieldComponent = InputField<FormData>({
            initialData,
            config,
          })
          return <FieldComponent key={`${config.type}-${index}`} form={inputFieldForm} />
        })}
        <Divider type='horizontal' />
        {!showAllSettings && (
          <ShowAllSettings
            handleShowAllSettings={handleShowAllSettings}
            description={hiddenFieldNames}
          />
        )}
        {showAllSettings && (
          <>
            {hiddenConfigurations.map((config, index) => {
              const FieldComponent = InputField<FormData>({
                initialData,
                config,
              })
              return <FieldComponent key={`hidden-${config.type}-${index}`} form={inputFieldForm} />
            })}
          </>
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
