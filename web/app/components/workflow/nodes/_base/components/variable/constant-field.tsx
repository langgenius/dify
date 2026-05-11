'use client'
import type { FC } from 'react'
import type { CredentialFormSchema, CredentialFormSchemaNumberInput, CredentialFormSchemaSelect } from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { Var } from '@/app/components/workflow/types'
import { Select, SelectContent, SelectItem, SelectItemIndicator, SelectItemText, SelectTrigger } from '@langgenius/dify-ui/select'
import * as React from 'react'
import { useCallback, useMemo } from 'react'
import { FormTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { useLanguage } from '@/app/components/header/account-setting/model-provider-page/hooks'
import { VarType as VarKindType } from '@/app/components/workflow/nodes/tool/types'

type Props = {
  schema: Partial<CredentialFormSchema>
  readonly: boolean
  value: string
  onChange: (value: string | number, varKindType: VarKindType, varInfo?: Var) => void
  onOpenChange?: (open: boolean) => void
  isLoading?: boolean
}

const DEFAULT_SCHEMA = {} as CredentialFormSchema

const ConstantField: FC<Props> = ({
  schema = DEFAULT_SCHEMA,
  readonly,
  value,
  onChange,
  onOpenChange,
  isLoading,
}) => {
  const language = useLanguage()
  const placeholder = (schema as CredentialFormSchemaSelect).placeholder
  const selectOptions = useMemo(() => {
    if (schema.type !== FormTypeEnum.select && schema.type !== FormTypeEnum.dynamicSelect)
      return []

    return (schema as CredentialFormSchemaSelect).options.map(option => ({
      value: String(option.value),
      name: option.label[language] || option.label.en_US,
    }))
  }, [language, schema])
  const selectedOption = useMemo(() => {
    return selectOptions.find(option => option.value === String(value)) ?? null
  }, [selectOptions, value])
  const handleStaticChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value === '' ? '' : Number.parseFloat(e.target.value)
    onChange(value, VarKindType.constant)
  }, [onChange])
  const handleSelectChange = useCallback((value: string | number) => {
    value = value === null ? '' : value
    onChange(value as string, VarKindType.constant)
  }, [onChange])

  return (
    <>
      {(schema.type === FormTypeEnum.select || schema.type === FormTypeEnum.dynamicSelect) && (
        <Select
          value={selectedOption?.value ?? null}
          disabled={readonly || isLoading}
          onValueChange={nextValue => nextValue && handleSelectChange(nextValue)}
          onOpenChange={onOpenChange}
        >
          <SelectTrigger
            className="h-8 w-full"
            disabled={readonly || isLoading}
          >
            {selectedOption?.name ?? placeholder?.[language] ?? placeholder?.en_US}
          </SelectTrigger>
          <SelectContent>
            {selectOptions.map(option => (
              <SelectItem key={option.value} value={option.value}>
                <SelectItemText>{option.name}</SelectItemText>
                <SelectItemIndicator />
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {schema.type === FormTypeEnum.textNumber && (
        <input
          type="number"
          className="h-8 w-full overflow-hidden rounded-lg bg-workflow-block-parma-bg p-2 text-[13px] leading-8 font-normal text-text-secondary placeholder:text-gray-400 focus:outline-hidden"
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
