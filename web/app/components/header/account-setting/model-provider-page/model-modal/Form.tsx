import { useState } from 'react'
import type { FC } from 'react'
import {
  RiQuestionLine,
} from '@remixicon/react'
import { ValidatingTip } from '../../key-validator/ValidateStatus'
import type {
  CredentialFormSchema,
  CredentialFormSchemaNumberInput,
  CredentialFormSchemaRadio,
  CredentialFormSchemaSecretInput,
  CredentialFormSchemaSelect,
  CredentialFormSchemaTextInput,
  FormValue,
} from '../declarations'
import { FormTypeEnum } from '../declarations'
import { useLanguage } from '../hooks'
import Input from './Input'
import cn from '@/utils/classnames'
import { SimpleSelect } from '@/app/components/base/select'
import Tooltip from '@/app/components/base/tooltip-plus'
import Radio from '@/app/components/base/radio'
type FormProps = {
  className?: string
  itemClassName?: string
  fieldLabelClassName?: string
  value: FormValue
  onChange: (val: FormValue) => void
  formSchemas: CredentialFormSchema[]
  validating: boolean
  validatedSuccess?: boolean
  showOnVariableMap: Record<string, string[]>
  isEditMode: boolean
  readonly?: boolean
  inputClassName?: string
  isShowDefaultValue?: boolean
  fieldMoreInfo?: (payload: CredentialFormSchema) => JSX.Element | null
}

const Form: FC<FormProps> = ({
  className,
  itemClassName,
  fieldLabelClassName,
  value,
  onChange,
  formSchemas,
  validating,
  validatedSuccess,
  showOnVariableMap,
  isEditMode,
  readonly,
  inputClassName,
  isShowDefaultValue = false,
  fieldMoreInfo,
}) => {
  const language = useLanguage()
  const [changeKey, setChangeKey] = useState('')

  const handleFormChange = (key: string, val: string | boolean) => {
    if (isEditMode && (key === '__model_type' || key === '__model_name'))
      return

    setChangeKey(key)
    const shouldClearVariable: Record<string, string | undefined> = {}
    if (showOnVariableMap[key]?.length) {
      showOnVariableMap[key].forEach((clearVariable) => {
        shouldClearVariable[clearVariable] = undefined
      })
    }
    onChange({ ...value, [key]: val, ...shouldClearVariable })
  }

  const renderField = (formSchema: CredentialFormSchema) => {
    const tooltip = formSchema.tooltip
    const tooltipContent = (tooltip && (
      <span className='ml-1 pt-1.5'>
        <Tooltip popupContent={
          // w-[100px] caused problem
          <div className=''>
            {tooltip[language] || tooltip.en_US}
          </div>
        } >
          <RiQuestionLine className='w-3 h-3  text-gray-500' />
        </Tooltip>
      </span>))
    if (formSchema.type === FormTypeEnum.textInput || formSchema.type === FormTypeEnum.secretInput || formSchema.type === FormTypeEnum.textNumber) {
      const {
        variable,
        label,
        placeholder,
        required,
        show_on,
      } = formSchema as (CredentialFormSchemaTextInput | CredentialFormSchemaSecretInput)

      if (show_on.length && !show_on.every(showOnItem => value[showOnItem.variable] === showOnItem.value))
        return null

      const disabed = readonly || (isEditMode && (variable === '__model_type' || variable === '__model_name'))
      return (
        <div key={variable} className={cn(itemClassName, 'py-3')}>
          <div className={cn(fieldLabelClassName, 'py-2 text-sm text-gray-900')}>
            {label[language] || label.en_US}
            {
              required && (
                <span className='ml-1 text-red-500'>*</span>
              )
            }
            {tooltipContent}
          </div>
          <Input
            className={cn(inputClassName, `${disabed && 'cursor-not-allowed opacity-60'}`)}
            value={(isShowDefaultValue && ((value[variable] as string) === '' || value[variable] === undefined || value[variable] === null)) ? formSchema.default : value[variable]}
            onChange={val => handleFormChange(variable, val)}
            validated={validatedSuccess}
            placeholder={placeholder?.[language] || placeholder?.en_US}
            disabled={disabed}
            type={formSchema.type === FormTypeEnum.textNumber ? 'number' : 'text'}
            {...(formSchema.type === FormTypeEnum.textNumber ? { min: (formSchema as CredentialFormSchemaNumberInput).min, max: (formSchema as CredentialFormSchemaNumberInput).max } : {})}
          />
          {fieldMoreInfo?.(formSchema)}
          {validating && changeKey === variable && <ValidatingTip />}
        </div>
      )
    }

    if (formSchema.type === FormTypeEnum.radio) {
      const {
        options,
        variable,
        label,
        show_on,
        required,
      } = formSchema as CredentialFormSchemaRadio

      if (show_on.length && !show_on.every(showOnItem => value[showOnItem.variable] === showOnItem.value))
        return null

      const disabed = isEditMode && (variable === '__model_type' || variable === '__model_name')

      return (
        <div key={variable} className={cn(itemClassName, 'py-3')}>
          <div className={cn(fieldLabelClassName, 'py-2 text-sm text-gray-900')}>
            {label[language] || label.en_US}
            {
              required && (
                <span className='ml-1 text-red-500'>*</span>
              )
            }
            {tooltipContent}
          </div>
          <div className={`grid grid-cols-${options?.length} gap-3`}>
            {
              options.filter((option) => {
                if (option.show_on.length)
                  return option.show_on.every(showOnItem => value[showOnItem.variable] === showOnItem.value)

                return true
              }).map(option => (
                <div
                  className={`
                    flex items-center px-3 py-2 rounded-lg border border-gray-100 bg-gray-25 cursor-pointer
                    ${value[variable] === option.value && 'bg-white border-[1.5px] border-primary-400 shadow-sm'}
                    ${disabed && '!cursor-not-allowed opacity-60'}
                  `}
                  onClick={() => handleFormChange(variable, option.value)}
                  key={`${variable}-${option.value}`}
                >
                  <div className={`
                    flex justify-center items-center mr-2 w-4 h-4 border border-gray-300 rounded-full
                    ${value[variable] === option.value && 'border-[5px] border-primary-600'}
                  `} />
                  <div className='text-sm text-gray-900'>{option.label[language] || option.label.en_US}</div>
                </div>
              ))
            }
          </div>
          {fieldMoreInfo?.(formSchema)}
          {validating && changeKey === variable && <ValidatingTip />}
        </div>
      )
    }

    if (formSchema.type === 'select') {
      const {
        options,
        variable,
        label,
        show_on,
        required,
        placeholder,
      } = formSchema as CredentialFormSchemaSelect

      if (show_on.length && !show_on.every(showOnItem => value[showOnItem.variable] === showOnItem.value))
        return null

      return (
        <div key={variable} className={cn(itemClassName, 'py-3')}>
          <div className={cn(fieldLabelClassName, 'py-2 text-sm text-gray-900')}>
            {label[language] || label.en_US}

            {
              required && (
                <span className='ml-1 text-red-500'>*</span>
              )
            }
            {tooltipContent}
          </div>
          <SimpleSelect
            className={cn(inputClassName)}
            disabled={readonly}
            defaultValue={(isShowDefaultValue && ((value[variable] as string) === '' || value[variable] === undefined || value[variable] === null)) ? formSchema.default : value[variable]}
            items={options.filter((option) => {
              if (option.show_on.length)
                return option.show_on.every(showOnItem => value[showOnItem.variable] === showOnItem.value)

              return true
            }).map(option => ({ value: option.value, name: option.label[language] || option.label.en_US }))}
            onSelect={item => handleFormChange(variable, item.value as string)}
            placeholder={placeholder?.[language] || placeholder?.en_US}
          />
          {fieldMoreInfo?.(formSchema)}
          {validating && changeKey === variable && <ValidatingTip />}
        </div>
      )
    }

    if (formSchema.type === 'boolean') {
      const {
        variable,
        label,
        show_on,
        required,
      } = formSchema as CredentialFormSchemaRadio

      if (show_on.length && !show_on.every(showOnItem => value[showOnItem.variable] === showOnItem.value))
        return null

      return (
        <div key={variable} className={cn(itemClassName, 'py-3')}>
          <div className='flex items-center justify-between py-2 text-sm text-gray-900'>
            <div className='flex items-center space-x-2'>
              <span className={cn(fieldLabelClassName, 'py-2 text-sm text-gray-900')}>{label[language] || label.en_US}</span>
              {
                required && (
                  <span className='ml-1 text-red-500'>*</span>
                )
              }
              {tooltipContent}
            </div>
            <Radio.Group
              className='flex items-center'
              value={value[variable] === null ? undefined : (value[variable] ? 1 : 0)}
              onChange={val => handleFormChange(variable, val === 1)}
            >
              <Radio value={1} className='!mr-1'>True</Radio>
              <Radio value={0}>False</Radio>
            </Radio.Group>
          </div>
          {fieldMoreInfo?.(formSchema)}
        </div>
      )
    }
  }

  return (
    <div className={className}>
      {
        formSchemas.map(formSchema => renderField(formSchema))
      }
    </div>
  )
}

export default Form
