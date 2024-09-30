import React, { useState } from 'react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import { RiBookOpenLine } from '@remixicon/react'
import type { CreateExternalAPIReq, FormSchema } from '../declarations'
import Input from '@/app/components/base/input'
import cn from '@/utils/classnames'

type FormProps = {
  className?: string
  itemClassName?: string
  fieldLabelClassName?: string
  value: CreateExternalAPIReq
  onChange: (val: CreateExternalAPIReq) => void
  formSchemas: FormSchema[]
  inputClassName?: string
}

const Form: FC<FormProps> = React.memo(({
  className,
  itemClassName,
  fieldLabelClassName,
  value,
  onChange,
  formSchemas,
  inputClassName,
}) => {
  const { t, i18n } = useTranslation()
  const [changeKey, setChangeKey] = useState('')

  const handleFormChange = (key: string, val: string) => {
    setChangeKey(key)
    if (key === 'name') {
      onChange({ ...value, [key]: val })
    }
    else {
      onChange({
        ...value,
        settings: {
          ...value.settings,
          [key]: val,
        },
      })
    }
  }

  const renderField = (formSchema: FormSchema) => {
    const { variable, type, label, required } = formSchema
    const fieldValue = variable === 'name' ? value[variable] : (value.settings[variable as keyof typeof value.settings] || '')

    return (
      <div key={variable} className={cn(itemClassName, 'flex flex-col items-start gap-1 self-stretch')}>
        <div className="flex justify-between items-center w-full">
          <label className={cn(fieldLabelClassName, 'text-text-secondary system-sm-semibold')} htmlFor={variable}>
            {label[i18n.language] || label.en_US}
            {required && <span className='ml-1 text-red-500'>*</span>}
          </label>
          {variable === 'endpoint' && (
            <a
              href={'https://docs.dify.ai/guides/knowledge-base/external-knowledge-api-documentation' || '/'}
              target='_blank'
              rel='noopener noreferrer'
              className='text-text-accent body-xs-regular flex items-center'
            >
              <RiBookOpenLine className='w-3 h-3 text-text-accent mr-1' />
              {t('dataset.externalAPIPanelDocumentation')}
            </a>
          )}
        </div>
        <Input
          type={type === 'secret' ? 'password' : 'text'}
          id={variable}
          name={variable}
          value={fieldValue}
          onChange={val => handleFormChange(variable, val.target.value)}
          required={required}
          className={cn(inputClassName)}
        />
      </div>
    )
  }

  return (
    <form className={cn('flex flex-col justify-center items-start gap-4 self-stretch', className)}>
      {formSchemas.map(formSchema => renderField(formSchema))}
    </form>
  )
})

export default Form
