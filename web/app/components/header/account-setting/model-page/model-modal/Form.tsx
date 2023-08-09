import { useState } from 'react'
import type { FC } from 'react'
import { useContext } from 'use-context-selector'
import type { Field, FormValue } from '../declarations'
import { Input, InputWithStatus } from './Input'
import I18n from '@/context/i18n'

type FormProps = {
  initValue?: FormValue
  fields: Field[]
  onChange: (v: FormValue) => void
  onValidatedError: (v: string) => void
}

const nameClassName = `
py-2 text-sm text-gray-900
`

const Form: FC<FormProps> = ({
  initValue = {},
  fields,
  onChange,
  onValidatedError,
}) => {
  const { locale } = useContext(I18n)
  const [value, setValue] = useState(initValue)

  const handleFormChange = (k: string, v: string) => {
    setValue({ ...value, [k]: v })
    onChange({ ...value, [k]: v })
  }
  const handleMultiFormChange = (v: FormValue) => {
    setValue(v)
    onChange(v)
  }

  const renderField = (field: Field) => {
    if (field.type === 'text' && field.visible(value)) {
      return (
        <div key={field.key} className='py-3'>
          <div className={nameClassName}>{field.label[locale]}</div>
          {
            field.validate
              ? (
                <InputWithStatus
                  field={field}
                  initValue={initValue}
                  formValue={value}
                  onChange={handleMultiFormChange}
                  onValidatedError={onValidatedError}
                />
              )
              : (
                <Input
                  value={value?.[field.key] as string}
                  onChange={v => handleFormChange(field.key, v)}
                  placeholder={field?.placeholder?.[locale] || ''}
                />
              )
          }
        </div>
      )
    }

    if (field.type === 'radio' && field.visible(value)) {
      const options = typeof field.options === 'function' ? field.options(value) : field.options
      return (
        <div key={field.key} className='py-3'>
          <div className={nameClassName}>{field.label[locale]}</div>
          <div className='grid grid-cols-3 gap-3'>
            {
              options?.map(option => (
                <div
                  className={`
                    flex items-center px-3 h-9 rounded-lg border border-gray-100 bg-gray-25 cursor-pointer
                    ${value?.[field.key] === option.key && 'bg-white border-[1.5px] border-primary-400 shadow-sm'}
                  `}
                  onClick={() => handleFormChange(field.key, option.key)}
                  key={`${field.key}-${option.key}`}
                >
                  <div className={`
                    flex justify-center items-center mr-2 w-4 h-4 border border-gray-300 rounded-full
                    ${value?.[field.key] === option.key && 'border-[5px] border-primary-600'}
                  `} />
                  <div className='text-sm text-gray-900'>{option.label[locale]}</div>
                </div>
              ))
            }
          </div>
        </div>
      )
    }
  }

  return (
    <div>
      {
        fields.map(field => renderField(field))
      }
    </div>
  )
}

export default Form
