'use client'
import type { FC } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import GenericTable from './generic-table'
import type { ColumnConfig, GenericTableRow } from './generic-table'
import type { WebhookHeader } from '../types'

type HeaderTableProps = {
  readonly?: boolean
  headers?: WebhookHeader[]
  onChange: (headers: WebhookHeader[]) => void
}

const HeaderTable: FC<HeaderTableProps> = ({
  readonly = false,
  headers = [],
  onChange,
}) => {
  const { t } = useTranslation()

  // Define columns for header table - matching prototype design
  const columns: ColumnConfig[] = [
    {
      key: 'name',
      title: 'Variable Name',
      type: 'input',
      width: 'flex-1',
      placeholder: 'Variable Name',
    },
    {
      key: 'required',
      title: 'Required',
      type: 'switch',
      width: 'w-[88px]',
    },
  ]

  // No default prefilled row; table initializes with one empty row

  // Empty row template for new rows
  const emptyRowData: GenericTableRow = {
    name: '',
    required: false,
  }

  // Convert WebhookHeader[] to GenericTableRow[]
  const tableData: GenericTableRow[] = headers.map(header => ({
    name: header.name,
    required: header.required,
  }))

  // Handle data changes
  const handleDataChange = (data: GenericTableRow[]) => {
    const newHeaders: WebhookHeader[] = data
      .filter(row => row.name && typeof row.name === 'string' && row.name.trim() !== '')
      .map(row => ({
        name: (row.name as string) || '',
        required: !!row.required,
      }))
    onChange(newHeaders)
  }

  return (
    <GenericTable
      title="Header Parameters"
      columns={columns}
      data={tableData}
      onChange={handleDataChange}
      readonly={readonly}
      placeholder={t('workflow.nodes.triggerWebhook.noHeaders')}
      emptyRowData={emptyRowData}
      showHeader={true}
    />
  )
}

export default React.memo(HeaderTable)
