'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import GenericTable from './generic-table'
import type { ColumnConfig, GenericTableRow } from './generic-table'
import type { WebhookParam } from '../types'

type ParameterTableProps = {
  title: string
  parameters: WebhookParam[]
  onChange: (params: WebhookParam[]) => void
  readonly?: boolean
  placeholder?: string
  showType?: boolean
  isRequestBody?: boolean // Special handling for request body parameters
}

const ParameterTable: FC<ParameterTableProps> = ({
  title,
  parameters,
  onChange,
  readonly,
  placeholder,
  showType = true,
  isRequestBody = false,
}) => {
  const { t } = useTranslation()

  // Type options for request body parameters
  const typeOptions = [
    { name: 'String', value: 'string' },
    { name: 'Number', value: 'number' },
    { name: 'Boolean', value: 'boolean' },
    { name: 'Array', value: 'array' },
    { name: 'Object', value: 'object' },
  ]

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
        width: 'w-[96px]',
        placeholder: 'Type',
        options: isRequestBody ? typeOptions : undefined,
      }]
      : []),
    {
      key: 'required',
      title: 'Required',
      type: 'switch',
      width: 'w-[48px]',
    },
  ]

  // Empty row template for new rows
  const emptyRowData: GenericTableRow = {
    key: '',
    type: '',
    required: false,
  }

  // Convert WebhookParam[] to GenericTableRow[]
  const tableData: GenericTableRow[] = parameters.map(param => ({
    key: param.key,
    type: param.type,
    required: param.required,
    value: param.value,
  }))

  const handleDataChange = (data: GenericTableRow[]) => {
    const newParams: WebhookParam[] = data
      .filter(row => typeof row.key === 'string' && (row.key as string).trim() !== '')
      .map(row => ({
        key: String(row.key),
        type: (row.type as string) || 'string',
        required: Boolean(row.required),
        value: (row.value as string) || '',
      }))
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
