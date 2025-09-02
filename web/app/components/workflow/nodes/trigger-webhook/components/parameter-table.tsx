'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import GenericTable from './generic-table'
import type { ColumnConfig, GenericTableRow } from './generic-table'
import type { ParameterType, WebhookParameter } from '../types'
import { createParameterTypeOptions, normalizeParameterType } from '../utils/parameter-type-utils'

type ParameterTableProps = {
  title: string
  parameters: WebhookParameter[]
  onChange: (params: WebhookParameter[]) => void
  readonly?: boolean
  placeholder?: string
  showType?: boolean
  isRequestBody?: boolean // Special handling for request body parameters
  contentType?: string
}

const ParameterTable: FC<ParameterTableProps> = ({
  title,
  parameters,
  onChange,
  readonly,
  placeholder,
  showType = true,
  isRequestBody = false,
  contentType,
}) => {
  const { t } = useTranslation()

  const typeOptions = createParameterTypeOptions(contentType, isRequestBody)

  // Define columns based on component type - matching prototype design
  const columns: ColumnConfig[] = [
    {
      key: 'key',
      title: isRequestBody ? 'Name' : 'Variable Name',
      type: 'input',
      width: 'flex-1',
      placeholder: isRequestBody ? 'Name' : 'Variable Name',
    },
    ...(showType
      ? [{
        key: 'type',
        title: 'Type',
        type: (isRequestBody ? 'select' : 'input') as ColumnConfig['type'],
        width: 'w-[78px]',
        placeholder: 'Type',
        options: isRequestBody ? typeOptions : undefined,
      }]
      : []),
    {
      key: 'required',
      title: 'Required',
      type: 'switch',
      width: 'w-[88px]',
    },
  ]

  // Choose sensible default type for new rows according to content type
  const defaultTypeValue: ParameterType = typeOptions[0]?.value || 'string'

  // Empty row template for new rows
  const emptyRowData: GenericTableRow = {
    key: '',
    type: isRequestBody ? defaultTypeValue : '',
    required: false,
  }

  const tableData: GenericTableRow[] = parameters.map(param => ({
    key: param.name,
    type: param.type,
    required: param.required,
  }))

  const handleDataChange = (data: GenericTableRow[]) => {
    // For text/plain, enforce single text body semantics: keep only first non-empty row and force string type
    const isTextPlain = isRequestBody && (contentType || '').toLowerCase() === 'text/plain'

    const normalized = data
      .filter(row => typeof row.key === 'string' && (row.key as string).trim() !== '')
      .map(row => ({
        name: String(row.key),
        type: isTextPlain ? 'string' : normalizeParameterType((row.type as string) || 'string'),
        required: Boolean(row.required),
      }))

    const newParams: WebhookParameter[] = isTextPlain
      ? normalized.slice(0, 1)
      : normalized

    onChange(newParams)
  }

  return (
    <GenericTable
      title={title}
      columns={columns}
      data={tableData}
      onChange={handleDataChange}
      readonly={readonly}
      placeholder={placeholder || t('workflow.nodes.triggerWebhook.noParameters')}
      emptyRowData={emptyRowData}
      showHeader={true}
    />
  )
}

export default ParameterTable
