import type { FC } from 'react'
import type { CreateExternalAPIReq, FormSchema } from '../declarations'
import { RiBookOpenLine } from '@remixicon/react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import Input from '@/app/components/base/input'
import { useDocLink } from '@/context/i18n'
import { cn } from '@/utils/classnames'

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
  const docLink = useDocLink()

  const handleFormChange = (key: string, val: string) => {
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
        <div className="flex w-full items-center justify-between">
          <label className={cn(fieldLabelClassName, 'system-sm-semibold text-text-secondary')} htmlFor={variable}>
            {label[i18n.language] || label.en_US}
            {required && <span className="ml-1 text-red-500">*</span>}
          </label>
          {variable === 'endpoint' && (
            <a
              href={docLink('/use-dify/knowledge/external-knowledge-api') || '/'}
              target="_blank"
              rel="noopener noreferrer"
              className="body-xs-regular flex items-center text-text-accent"
            >
              <RiBookOpenLine className="mr-1 h-3 w-3 text-text-accent" />
              {t('externalAPIPanelDocumentation', { ns: 'dataset' })}
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
    <form className={cn('flex flex-col items-start justify-center gap-4 self-stretch', className)}>
      {formSchemas.map(formSchema => renderField(formSchema))}
    </form>
  )
})

Form.displayName = 'Form'

export default Form
