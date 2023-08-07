import { useState } from 'react'
import type { FC } from 'react'
import { useContext } from 'use-context-selector'
import type { Field, FormValue } from '../declarations'
import { Input, InputWithStatus } from './Input'
import I18n from '@/context/i18n'
import Switch from '@/app/components/base/switch'
import { HelpCircle } from '@/app/components/base/icons/src/vender/line/general'
import Tooltip from '@/app/components/base/tooltip'

type FormProps = {
  initValue?: FormValue
  fields: Field[]
}

const nameClassName = `
py-2 text-sm text-gray-900
`

const Form: FC<FormProps> = ({
  initValue,
  fields,
}) => {
  const { locale } = useContext(I18n)
  const [value, setValue] = useState(initValue)

  const handleFormChange = (k: string, v: string | boolean) => {
    setValue({ ...value, [k]: v })
  }

  const renderField = (field: Field) => {
    if (field.type === 'text' && field.visible(value)) {
      if (field.switch && field.switchKey) {
        return (
          <div key={field.key} className='py-3'>
            <div className='flex items-center'>
              <Switch size='l' onChange={v => handleFormChange(field?.switchKey || '', v)} />
              <div className='ml-2 text-sm font-medium text-gray-900'>{field.label[locale]}</div>
              <Tooltip
                selector={`setting-model-provider-form-${field.key}`}
                content={field.help?.[locale]}
              >
                <div className='flex items-center justify-center ml-1'>
                  <HelpCircle className='w-[14px] h-[14px] text-gray-400' />
                </div>
              </Tooltip>
            </div>
            {
              value?.[field.switchKey] && (
                <div className='mt-2'>
                  <Input
                    value={value?.[field.key] as string}
                    onChange={v => handleFormChange(field.key, v)}
                    placeholder={field.placeholder?.[locale] || ''}
                  />
                </div>
              )
            }
          </div>
        )
      }
      return (
        <div key={field.key} className='py-3'>
          <div className={nameClassName}>{field.label[locale]}</div>
          {
            field.validate
              ? (
                <InputWithStatus
                  field={field}
                  formValue={value || {}}
                  onChange={v => setValue(v)}
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
      return (
        <div key={field.key} className='py-3'>
          <div className={nameClassName}>{field.label[locale]}</div>
          <div className={`grid grid-cols-${field?.options?.length} gap-3`}>
            {
              field?.options?.map(option => (
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
