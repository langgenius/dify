/**
 * @fileoverview CSV Operations Hook
 * Handles CSV upload, download, and conversion operations for Excel Viewer
 */
import type { Matrix } from 'react-spreadsheet'
import { useCallback } from 'react'
import { usePapaParse } from 'react-papaparse'
import Toast from '@/app/components/base/toast'

type SpreadsheetCell = {
  value: string
  readOnly?: boolean
}

type ExcelConfig = {
  editable?: boolean
  editableHeader?: boolean
}

type TranslateFn = (key: string, options?: { ns?: string }) => string

type CsvOperationsHook = {
  convertToCSV: (rawData: string[][]) => string
  convertToRawData: (spreadsheetData: Matrix<SpreadsheetCell>) => string[][]
  handleDownload: (spreadsheetData: Matrix<SpreadsheetCell>, filename?: string) => void
  handleUpload: (
    onSuccess: (data: Matrix<SpreadsheetCell>) => void,
    config?: ExcelConfig,
    t?: TranslateFn,
  ) => void
}

/**
 * Custom hook for CSV operations
 * Provides CSV conversion, download, and upload functionality
 */
export const useCsvOperations = (): CsvOperationsHook => {
  const { readString } = usePapaParse()

  /**
   * Convert raw 2D array to CSV format string
   * Handles escaping for commas, quotes, and newlines per CSV RFC 4180
   */
  const convertToCSV = useCallback((rawData: string[][]): string => {
    return rawData.map(row =>
      row.map((cell) => {
        const cellStr = String(cell || '')
        // Escape cells containing comma, quote, or newline
        if (cellStr.includes(',') || cellStr.includes('"') || cellStr.includes('\n')) {
          // Escape quotes by doubling them, then wrap in quotes
          return `"${cellStr.replace(/"/g, '""')}"`
        }
        return cellStr
      }).join(','),
    ).join('\n')
  }, [])

  /**
   * Convert Spreadsheet data back to raw 2D array
   */
  const convertToRawData = useCallback((spreadsheetData: Matrix<SpreadsheetCell>): string[][] => {
    return spreadsheetData.map(row =>
      row.map(cell => cell?.value || ''),
    )
  }, [])

  /**
   * Download spreadsheet data as CSV file
   * Always downloads the complete data including hidden columns
   */
  const handleDownload = useCallback((
    spreadsheetData: Matrix<SpreadsheetCell>,
    filename: string = `excel-data-${Date.now()}.csv`,
  ) => {
    const rawData = convertToRawData(spreadsheetData)
    const csvContent = convertToCSV(rawData)

    // Create blob and download
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    const url = URL.createObjectURL(blob)

    link.setAttribute('href', url)
    link.setAttribute('download', filename)
    link.style.visibility = 'hidden'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }, [convertToRawData, convertToCSV])

  /**
   * Handle CSV file upload and replace current data
   * Parses CSV, filters empty rows, and converts to spreadsheet format
   */
  const handleUpload = useCallback((
    onSuccess: (data: Matrix<SpreadsheetCell>) => void,
    config?: ExcelConfig,
    t: TranslateFn = key => key,
  ) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.csv'
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (!file)
        return

      const reader = new FileReader()
      reader.onload = (event) => {
        const csvContent = event.target?.result as string
        if (!csvContent)
          return

        // Parse CSV content
        readString(csvContent, {
          complete: (results) => {
            const rawData = results.data as string[][]
            // Filter out empty rows
            const filteredData = rawData.filter(row =>
              row.some(cell => cell && cell.trim() !== ''),
            )

            if (filteredData.length === 0) {
              Toast.notify({
                type: 'error',
                message: t('chat.excelViewer.uploadEmptyFile', { ns: 'common' }),
              })
              return
            }

            // Convert to spreadsheet format
            const isEditable = config?.editable !== false
            const isEditableHeader = config?.editableHeader !== false
            const spreadsheetData = filteredData.map((row, rowIndex) =>
              row.map(cell => ({
                value: cell || '',
                readOnly: !isEditable || (rowIndex === 0 && !isEditableHeader),
              })),
            )

            onSuccess(spreadsheetData)
            Toast.notify({
              type: 'success',
              message: t('chat.excelViewer.uploadSuccess', { ns: 'common' }),
            })
          },
          error: (error: Error) => {
            Toast.notify({
              type: 'error',
              message: `${t('chat.excelViewer.uploadFailed', { ns: 'common' })}: ${error.message}`,
            })
          },
        })
      }
      reader.readAsText(file)
    }
    input.click()
  }, [readString])

  return {
    convertToCSV,
    convertToRawData,
    handleDownload,
    handleUpload,
  }
}
