'use client'
import type { FC } from 'react'
import React, { useCallback } from 'react'
import type { CredentialFormSchema, CredentialFormSchemaNumberInput, CredentialFormSchemaSelect } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { FormTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { useLanguage } from '@/app/components/header/account-setting/model-provider-page/hooks'
import { VarType as VarKindType } from '@/app/components/workflow/nodes/tool/types'
import type { Var } from '@/app/components/workflow/types'
import { SimpleSelect } from '@/app/components/base/select'

type Props = {
  schema: Partial<CredentialFormSchema>
  readonly: boolean
  value: string
  onChange: (value: string | number, varKindType: VarKindType, varInfo?: Var) => void
}

const ConstantField: FC<Props> = ({
  schema = {} as CredentialFormSchema,
  readonly,
  value,
  onChange,
}) => {
  const language = useLanguage()
  const placeholder = (schema as CredentialFormSchemaSelect).placeholder
  const handleStaticChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value === '' ? '' : parseFloat(e.target.value)
    onChange(value, VarKindType.constant)
  }, [onChange])
  const handleSelectChange = useCallback((value: string | number) => {
    value = value === null ? '' : value
    onChange(value as string, VarKindType.constant)
  }, [onChange])

  return (
    <>
      {schema.type === FormTypeEnum.select && (
        <SimpleSelect
          wrapperClassName='w-full !h-8'
          className='flex items-center'
          disabled={readonly}
          items={(schema as CredentialFormSchemaSelect).options.map(option => ({ value: option.value, name: option.label[language] || option.label.en_US }))}
          onSelect={item => handleSelectChange(item.value)}
          placeholder={placeholder?.[language] || placeholder?.en_US}
        />
      )}
      {schema.type === FormTypeEnum.textNumber && (
        <input
          type='number'
          className='w-full h-8 leading-8 p-2 rounded-lg bg-gray-100 text-[13px] font-normal text-gray-900 placeholder:text-gray-400 focus:outline-none overflow-hidden'
          value={value}
          onChange={handleStaticChange}
          readOnly={readonly}
          placeholder={placeholder?.[language] || placeholder?.en_US}
          min={(schema as CredentialFormSchemaNumberInput).min}
          max={(schema as CredentialFormSchemaNumberInput).max}
        />
      )}
    </>
  )
}
export default React.memo(ConstantField)
