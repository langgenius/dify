'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import GenericTable from './generic-table'
import type { ColumnConfig, GenericTableRow } from './generic-table'
import type { ParameterType, WebhookParameter } from '../types'

const normalizeParamType = (type: string): ParameterType => {
  switch (type) {
    case 'string':
    case 'number':
    case 'boolean':
    case 'array':
    case 'object':
      return type
    default:
      return 'string'
  }
}

type ParameterTableProps = {
  title: string
  parameters: WebhookParameter[]
  onChange: (params: WebhookParameter[]) => void
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

  // Empty row template for new rows
  const emptyRowData: GenericTableRow = {
    key: '',
    type: isRequestBody ? 'string' : '',
    required: false,
  }

  const tableData: GenericTableRow[] = parameters.map(param => ({
    key: param.name,
    type: param.type,
    required: param.required,
  }))

  const handleDataChange = (data: GenericTableRow[]) => {
    const newParams: WebhookParameter[] = data
      .filter(row => typeof row.key === 'string' && (row.key as string).trim() !== '')
      .map(row => ({
        name: String(row.key),
        type: normalizeParamType((row.type as string) || 'string'),
        required: Boolean(row.required),
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
