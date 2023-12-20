import { useState } from 'react'
import type { FC } from 'react'
import { useContext } from 'use-context-selector'
import { ValidatingTip } from '../../key-validator/ValidateStatus'
import type {
  CredentialFormSchema,
  CredentialFormSchemaRadio,
  CredentialFormSchemaSecretInput,
  CredentialFormSchemaSelect,
  CredentialFormSchemaTextInput,
  FormValue,
} from '../declarations'
import { FormTypeEnum } from '../declarations'
import { languageMaps } from '../utils'
import Input from './Input'
import I18n from '@/context/i18n'
import { SimpleSelect } from '@/app/components/base/select'

type FormProps = {
  value: FormValue
  onChange: (val: FormValue) => void
  formSchemas: CredentialFormSchema[]
  validating: boolean
  validatedSuccess?: boolean
}

const Form: FC<FormProps> = ({
  value,
  onChange,
  formSchemas,
  validating,
  validatedSuccess,
}) => {
  const { locale } = useContext(I18n)
  const language = languageMaps[locale]
  const [changeKey, setChangeKey] = useState('')

  const handleFormChange = (key: string, val: string) => {
    setChangeKey(key)
    onChange({ ...value, [key]: val })
  }

  const renderField = (formSchema: CredentialFormSchema) => {
    if (formSchema.type === FormTypeEnum.textInput || formSchema.type === FormTypeEnum.secretInput) {
      const {
        variable,
        label,
        placeholder,
        required,
      } = formSchema as (CredentialFormSchemaTextInput | CredentialFormSchemaSecretInput)
      return (
        <div key={variable} className='py-3'>
          <div className='py-2 text-sm text-gray-900'>
            {label[language]}
            {
              required && (
                <span className='ml-1 text-red-500'>*</span>
              )
            }
          </div>
          <Input
            value={value[variable] as string}
            onChange={val => handleFormChange(variable, val)}
            validated={validatedSuccess}
            placeholder={placeholder[language]}
          />
          {validating && changeKey === variable && <ValidatingTip />}
        </div>
      )
    }

    if (formSchema.type === FormTypeEnum.radio) {
      const {
        options,
        variable,
        label,
      } = formSchema as CredentialFormSchemaRadio

      return (
        <div key={variable} className='py-3'>
          <div className='py-2 text-sm text-gray-900'>{label[language]}</div>
          <div className={`grid grid-cols-${options?.length} gap-3`}>
            {
              options?.map(option => (
                <div
                  className={`
                    flex items-center px-3 py-2 rounded-lg border border-gray-100 bg-gray-25 cursor-pointer
                    ${value[variable] === option.value && 'bg-white border-[1.5px] border-primary-400 shadow-sm'}
                  `}
                  onClick={() => handleFormChange(variable, option.value)}
                  key={`${variable}-${option.value}`}
                >
                  <div className={`
                    flex justify-center items-center mr-2 w-4 h-4 border border-gray-300 rounded-full
                    ${value[variable] === option.value && 'border-[5px] border-primary-600'}
                  `} />
                  <div className='text-sm text-gray-900'>{option.label[language]}</div>
                </div>
              ))
            }
          </div>
          {validating && changeKey === variable && <ValidatingTip />}
        </div>
      )
    }

    if (formSchema.type === 'select') {
      const {
        options,
        variable,
        label,
      } = formSchema as CredentialFormSchemaSelect

      return (
        <div key={variable} className='py-3'>
          <div className='py-2 text-sm text-gray-900'>{label[language]}</div>
          <SimpleSelect
            defaultValue={value[variable] as string}
            items={options.map(option => ({ value: option.value, name: option.label[language] }))}
            onSelect={item => handleFormChange(variable, item.value as string)}
          />
          {validating && changeKey === variable && <ValidatingTip />}
        </div>
      )
    }
  }

  return (
    <div>
      {
        formSchemas.map(formSchema => renderField(formSchema))
      }
    </div>
  )
}

export default Form
