import { useTranslation } from 'react-i18next'
import { useAppForm } from '../..'
import type { InputFieldFormProps } from './types'
import { getNewVarInWorkflow } from '@/utils/var'
import { useHiddenFieldNames, useInputTypes } from './hooks'
import Divider from '../../../divider'
import { useCallback, useMemo, useState } from 'react'
import { useStore } from '@tanstack/react-form'
import { InputVarType } from '@/app/components/workflow/types'
import ShowAllSettings from './show-all-settings'
import Button from '../../../button'
import UseFileTypesFields from './hooks/use-file-types-fields'
import UseUploadMethodField from './hooks/use-upload-method-field'
import UseMaxNumberOfUploadsField from './hooks/use-max-number-of-uploads-filed'
import { DEFAULT_FILE_UPLOAD_SETTING } from '@/app/components/workflow/constants'
import { DEFAULT_VALUE_MAX_LEN } from '@/config'

const InputFieldForm = ({
  initialData,
  supportFile = false,
  onCancel,
  onSubmit,
}: InputFieldFormProps) => {
  const { t } = useTranslation()
  const form = useAppForm({
    defaultValues: initialData || getNewVarInWorkflow(''),
    validators: {
      onSubmit: ({ value }) => {
        // TODO: Add validation logic here
        console.log('Validator form on submit:', value)
      },
    },
    onSubmit: ({ value }) => {
      // TODO: Add submit logic here
      onSubmit(value)
    },
  })

  const [showAllSettings, setShowAllSettings] = useState(false)
  const type = useStore(form.store, state => state.values.type)
  const options = useStore(form.store, state => state.values.options)
  const hiddenFieldNames = useHiddenFieldNames(type)
  const inputTypes = useInputTypes(supportFile)

  const FileTypesFields = UseFileTypesFields({ initialData })
  const UploadMethodField = UseUploadMethodField({ initialData })
  const MaxNumberOfUploads = UseMaxNumberOfUploadsField({ initialData })

  const isTextInput = [InputVarType.textInput, InputVarType.paragraph].includes(type)
  const isNumberInput = type === InputVarType.number
  const isSelectInput = type === InputVarType.select
  const isSingleFile = type === InputVarType.singleFile
  const isMultipleFile = type === InputVarType.multiFiles

  const defaultSelectOptions = useMemo(() => {
    if (isSelectInput && options) {
      const defaultOptions = [
        {
          value: '',
          label: t('appDebug.variableConfig.noDefaultSelected'),
        },
      ]
      const otherOptions = options.map((option: string) => ({
        value: option,
        label: option,
      }))
      return [...defaultOptions, ...otherOptions]
    }
    return []
  }, [isSelectInput, options, t])

  const handleTypeChange = useCallback((type: string) => {
    if ([InputVarType.singleFile, InputVarType.multiFiles].includes(type as InputVarType)) {
      (Object.keys(DEFAULT_FILE_UPLOAD_SETTING)).forEach((key) => {
        if (key !== 'max_length')
          form.setFieldValue(key as keyof typeof form.options.defaultValues, (DEFAULT_FILE_UPLOAD_SETTING as any)[key])
      })
      if (type === InputVarType.multiFiles)
        form.setFieldValue('max_length', DEFAULT_FILE_UPLOAD_SETTING.max_length)
    }
    if (type === InputVarType.paragraph)
      form.setFieldValue('max_length', DEFAULT_VALUE_MAX_LEN)
  }, [form])

  const handleShowAllSettings = useCallback(() => {
    setShowAllSettings(true)
  }, [])

  return (
    <form
      className='w-full'
      onSubmit={(e) => {
        e.preventDefault()
        e.stopPropagation()
        form.handleSubmit()
      }}
    >
      <div className='flex flex-col gap-4 px-4 py-2'>
        <form.AppField
          name='type'
          children={field => (
            <field.SelectField
              label={t('appDebug.variableConfig.fieldType')}
              options={inputTypes}
              onChange={handleTypeChange}
              popupProps={{
                wrapperClassName: 'z-40',
              }}
            />
          )}
        />
        <form.AppField
          name='variable'
          children={field => (
            <field.TextField
              label={t('appDebug.variableConfig.varName')}
              placeholder={t('appDebug.variableConfig.inputPlaceholder')!}
            />
          )}
        />
        <form.AppField
          name='label'
          children={field => (
            <field.TextField
              label={t('appDebug.variableConfig.labelName')}
              placeholder={t('appDebug.variableConfig.inputPlaceholder')!}
            />
          )}
        />
        {isTextInput && (
          <form.AppField
            name='max_length'
            children={field => (
              <field.NumberInputField
                label={t('appDebug.variableConfig.maxLength')}
              />
            )}
          />
        )}
        {isSelectInput && (
          <form.AppField
            name='options'
            listeners={{
              onChange: () => {
                form.setFieldValue('default', '')
              },
            }}
            children={field => (
              <field.OptionsField
                label={t('appDebug.variableConfig.options')}
              />
            )}
          />
        )}
        {(isSingleFile || isMultipleFile) && (
          <FileTypesFields form={form} />
        )}
        <form.AppField
          name='required'
          children={field => (
            <field.CheckboxField
              label={t('appDebug.variableConfig.required')}
            />
          )}
        />
        <Divider type='horizontal' />
        {!showAllSettings && (
          <ShowAllSettings
            handleShowAllSettings={handleShowAllSettings}
            description={hiddenFieldNames}
          />
        )}
        {showAllSettings && (
          <>
            {isTextInput && (
              <form.AppField
                name='default'
                children={field => (
                  <field.TextField
                    label={t('appDebug.variableConfig.defaultValue')}
                    placeholder={t('appDebug.variableConfig.defaultValuePlaceholder')!}
                    showOptional
                  />
                )}
              />
            )}
            {isNumberInput && (
              <form.AppField
                name='default'
                children={field => (
                  <field.NumberInputField
                    label={t('appDebug.variableConfig.defaultValue')}
                    placeholder={t('appDebug.variableConfig.defaultValuePlaceholder')!}
                    showOptional
                  />
                )}
              />
            )}
            {isSelectInput && (
              <form.AppField
                name='default'
                children={field => (
                  <field.SelectField
                    label={t('appDebug.variableConfig.startSelectedOption')}
                    options={defaultSelectOptions}
                    showOptional
                  />
                )}
              />
            )}
            {(isTextInput || isNumberInput) && (
              <form.AppField
                name='placeholder'
                children={field => (
                  <field.TextField
                    label={t('appDebug.variableConfig.placeholder')}
                    placeholder={t('appDebug.variableConfig.placeholderPlaceholder')!}
                    showOptional
                  />
                )}
              />
            )}
            {isNumberInput && (
              <form.AppField
                name='unit'
                children={field => (
                  <field.TextField
                    label={t('appDebug.variableConfig.unit')}
                    placeholder={t('appDebug.variableConfig.unitPlaceholder')!}
                    showOptional
                  />
                )}
              />
            )}
            {(isSingleFile || isMultipleFile) && (
              <UploadMethodField form={form} />
            )}
            {isMultipleFile && (
              <MaxNumberOfUploads form={form} />
            )}
            <form.AppField
              name='hint'
              children={(field) => {
                return (
                  <field.TextField
                    label={t('appDebug.variableConfig.tooltips')}
                    placeholder={t('appDebug.variableConfig.tooltipsPlaceholder')!}
                    showOptional
                  />
                )
                }
              }
            />
          </>
        )}
      </div>
      <div className='flex items-center justify-end gap-x-2 p-4 pt-2'>
        <Button variant='secondary' onClick={onCancel}>
          {t('common.operation.cancel')}
        </Button>
        <form.AppForm>
          <form.SubmitButton variant='primary'>
            {t('common.operation.save')}
          </form.SubmitButton>
        </form.AppForm>
      </div>
    </form>
  )
}

export default InputFieldForm
