import { useEffect, useState } from 'react'
import type { Dispatch, FC, SetStateAction } from 'react'
import { useContext } from 'use-context-selector'
import { type Field, type FormValue, type ProviderConfigModal, ProviderEnum } from '../declarations'
import { useValidate } from '../../key-validator/hooks'
import { ValidatingTip } from '../../key-validator/ValidateStatus'
import { validateModelProviderFn } from '../utils'
import Input from './Input'
import I18n from '@/context/i18n'
import { SimpleSelect } from '@/app/components/base/select'

type FormProps = {
  modelModal?: ProviderConfigModal
  initValue?: FormValue
  fields: Field[]
  onChange: (v: FormValue) => void
  onValidatedError: (v: string) => void
  mode: string
  cleared: boolean
  onClearedChange: Dispatch<SetStateAction<boolean>>
  onValidating: (validating: boolean) => void
}

const nameClassName = `
py-2 text-sm text-gray-900
`

const Form: FC<FormProps> = ({
  modelModal,
  initValue = {},
  fields,
  onChange,
  onValidatedError,
  mode,
  cleared,
  onClearedChange,
  onValidating,
}) => {
  const { locale } = useContext(I18n)
  const [value, setValue] = useState(initValue)
  const [validate, validating, validatedStatusState] = useValidate(value)
  const [changeKey, setChangeKey] = useState('')

  useEffect(() => {
    onValidatedError(validatedStatusState.message || '')
  }, [validatedStatusState, onValidatedError])
  useEffect(() => {
    onValidating(validating)
  }, [validating, onValidating])

  const updateValue = (v: FormValue) => {
    setValue(v)
    onChange(v)
  }

  const handleMultiFormChange = (v: FormValue, newChangeKey: string) => {
    updateValue(v)
    setChangeKey(newChangeKey)

    const validateKeys = (typeof modelModal?.validateKeys === 'function' ? modelModal?.validateKeys(v) : modelModal?.validateKeys) || []
    if (validateKeys.length) {
      validate({
        before: () => {
          for (let i = 0; i < validateKeys.length; i++) {
            if (!v[validateKeys[i]])
              return false
          }
          return true
        },
        run: () => {
          return validateModelProviderFn(modelModal!.key, modelModal?.filterValue ? modelModal?.filterValue(v) : v)
        },
      })
    }
  }

  const handleClear = (saveValue?: FormValue) => {
    const needClearFields = modelModal?.fields.filter(field => field.type !== 'radio')
    const newValue: Record<string, string> = {}
    needClearFields?.forEach((field) => {
      newValue[field.key] = ''
    })
    updateValue({ ...value, ...newValue, ...saveValue })
    onClearedChange(true)
  }

  const handleFormChange = (k: string, v: string) => {
    if (mode === 'edit' && !cleared) {
      handleClear({ [k]: v })
    }
    else {
      const extraValue: Record<string, string> = {}
      if (
        (
          (k === 'model_type' && v === 'embeddings' && value.huggingfacehub_api_type === 'inference_endpoints')
          || (k === 'huggingfacehub_api_type' && v === 'inference_endpoints' && value.model_type === 'embeddings')
        )
        && modelModal?.key === ProviderEnum.huggingface_hub
      )
        extraValue.task_type = 'feature-extraction'

      if (
        (
          (k === 'model_type' && v === 'text-generation' && value.huggingfacehub_api_type === 'inference_endpoints')
          || (k === 'huggingfacehub_api_type' && v === 'inference_endpoints' && value.model_type === 'text-generation')
        )
        && modelModal?.key === ProviderEnum.huggingface_hub
      )
        extraValue.task_type = 'text-generation'

      if (
        (
          (k === 'model_type' && v === 'chat' && value.huggingfacehub_api_type === 'inference_endpoints')
          || (k === 'huggingfacehub_api_type' && v === 'inference_endpoints' && value.model_type === 'chat')
        )
        && modelModal?.key === ProviderEnum.huggingface_hub
      )
        extraValue.task_type = 'question-answer'

      handleMultiFormChange({ ...value, [k]: v, ...extraValue }, k)
    }
  }

  const handleFocus = () => {
    if (mode === 'edit' && !cleared)
      handleClear()
  }

  const renderField = (field: Field) => {
    const hidden = typeof field.hidden === 'function' ? field.hidden(value) : field.hidden

    if (hidden)
      return null

    if (field.type === 'text') {
      return (
        <div key={field.key} className='py-3'>
          <div className={nameClassName}>{field.label[locale]}</div>
          <Input
            field={field}
            value={value}
            onChange={v => handleMultiFormChange(v, field.key)}
            onFocus={handleFocus}
            validatedStatusState={validatedStatusState}
          />
          {validating && changeKey === field.key && <ValidatingTip />}
        </div>
      )
    }

    if (field.type === 'radio') {
      const options = typeof field.options === 'function' ? field.options(value) : field.options
      return (
        <div key={field.key} className='py-3'>
          <div className={nameClassName}>{field.label[locale]}</div>
          <div className='grid grid-cols-2 gap-3'>
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
          {validating && changeKey === field.key && <ValidatingTip />}
        </div>
      )
    }

    if (field.type === 'select') {
      const options = typeof field.options === 'function' ? field.options(value) : field.options

      return (
        <div key={field.key} className='py-3'>
          <div className={nameClassName}>{field.label[locale]}</div>
          <SimpleSelect
            defaultValue={value[field.key]}
            items={options!.map(option => ({ value: option.key, name: option.label[locale] }))}
            onSelect={item => handleFormChange(field.key, item.value as string)}
          />
          {validating && changeKey === field.key && <ValidatingTip />}
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
