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
    ...(showType ? [{
      key: 'type',
      title: 'Type',
      type: isRequestBody ? 'select' as const : 'input' as const,
      width: 'w-[120px]',
      placeholder: 'Type',
      options: isRequestBody ? typeOptions : undefined,
    }] : []),
    {
      key: 'required',
      title: 'Required',
      type: 'switch',
      width: 'w-[100px]',
    },
  ]

  // Default data for the first row
  const defaultRowData: GenericTableRow = {
    key: 'variable_1',
    type: 'string',
    required: false,
  }

  // Empty row template for new rows
  const emptyRowData: GenericTableRow = {
    key: '',
    // IMPORTANT: keep empty so GenericTable's auto-add-empty-row logic does not treat it as filled
    // When converting back to WebhookParam, we already default missing type to 'string'
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

  // Handle data changes and convert back to WebhookParam[]
  const handleDataChange = (data: GenericTableRow[]) => {
    const newParams: WebhookParam[] = data
      .filter(row => row.key && row.key.trim() !== '')
      .map(row => ({
        key: row.key,
        type: row.type || 'string',
        required: !!row.required,
        value: row.value || '',
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
      defaultRowData={defaultRowData}
      emptyRowData={emptyRowData}
      showHeader={true}
    />
  )
}

export default ParameterTable
