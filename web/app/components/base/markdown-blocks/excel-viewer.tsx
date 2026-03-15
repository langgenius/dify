/**
 * @fileoverview Excel Viewer Component for Markdown Code Blocks
 *
 * Renders interactive Excel-like spreadsheets with editing and action capabilities.
 * Supports both streaming (AI response) and complete data scenarios.
 *
 * @example Usage in Markdown - Inline Data with Single Action:
 * ```editableExcel
 * {
 *   "data": [
 *     ["Header1", "Header2", "Header3"],
 *     ["Row1Col1", "Row1Col2", "Row1Col3"],
 *     ["Row2Col1", "Row2Col2", "Row2Col3"]
 *   ],
 *   "actions": [
 *     {
 *       "url": "https://api.example.com/submit",
 *       "headers": { "Authorization": "Bearer token" },
 *       "buttonText": "Submit Data",
 *       "buttonIcon": "submit",
 *       "buttonVariant": "primary"
 *     }
 *   ]
 * }
 * ```
 *
 * @example Multiple Action Buttons:
 * ```editableExcel
 * {
 *   "data": [["Name", "Age"], ["Alice", "25"]],
 *   "actions": [
 *     {
 *       "url": "https://api.example.com/save",
 *       "buttonText": "Save Draft",
 *       "buttonVariant": "secondary"
 *     },
 *     {
 *       "url": "https://api.example.com/submit",
 *       "buttonText": "Submit",
 *       "buttonVariant": "primary"
 *     }
 *   ]
 * }
 * ```
 *
 * @example Load from URL (Read-only):
 * ```editableExcel
 * {
 *   "url": "https://raw.githubusercontent.com/pvul/webcsv/main/data/test.csv",
 *   "editable": false
 * }
 * ```
 *
 * @example Editable Data with Header Protection:
 * ```editableExcel
 * {
 *   "data": [["Name", "Age"], ["Alice", "25"], ["Bob", "30"]],
 *   "editableHeader": false
 * }
 * ```
 *
 * @example Hide Columns by Index:
 * ```editableExcel
 * {
 *   "data": [["ID", "Name", "Password", "Email"], ["1", "Alice", "secret", "alice@example.com"]],
 *   "hiddenColumns": [0, 2]
 * }
 * ```
 *
 * @example Hide Columns by Header Name (Recommended):
 * ```editableExcel
 * {
 *   "data": [["ID", "Name", "Password", "Email"], ["1", "Alice", "secret", "alice@example.com"]],
 *   "hiddenColumnNames": ["ID", "Password"]
 * }
 * ```
 *
 * @example Action with Auto-send Message:
 * ```editableExcel
 * {
 *   "data": [["Task", "Status"], ["Review", "Pending"]],
 *   "actions": [
 *     {
 *       "url": "https://api.example.com/submit",
 *       "buttonText": "Submit Task"
 *     }
 *   ],
 *   "postAction": [
 *     {
 *       "type": "sendMessage",
 *       "message": "I've submitted the task list. What should we do next?"
 *     }
 *   ]
 * }
 * ```
 *
 * @example Action with Toast Notification:
 * ```editableExcel
 * {
 *   "data": [["Name", "Score"], ["Alice", "95"]],
 *   "actions": [
 *     {
 *       "url": "https://api.example.com/save",
 *       "buttonText": "Save Score"
 *     }
 *   ],
 *   "postAction": [
 *     {
 *       "type": "showToast",
 *       "message": "Score saved successfully!",
 *       "toastType": "success"
 *     }
 *   ]
 * }
 * ```
 *
 * @example Multiple Post Actions:
 * ```editableExcel
 * {
 *   "data": [["Order", "Status"], ["#12345", "Completed"]],
 *   "actions": [
 *     {
 *       "url": "https://api.example.com/submit",
 *       "buttonText": "Submit Order"
 *     }
 *   ],
 *   "postAction": [
 *     {
 *       "type": "showToast",
 *       "message": "Order submitted!",
 *       "toastType": "success"
 *     },
 *     {
 *       "type": "sendMessage",
 *       "message": "What else would you like to do?"
 *     }
 *   ]
 * }
 * ```
 *
 * @example API Response with Next Action:
 * ```json
 * {
 *   "status": "success",
 *   "nextAction": [
 *     {
 *       "type": "sendMessage",
 *       "message": "The data has been submitted. Would you like me to generate a report?"
 *     }
 *   ]
 * }
 * ```
 *
 * @example API Response with Toast Notification:
 * ```json
 * {
 *   "status": "success",
 *   "nextAction": [
 *     {
 *       "type": "showToast",
 *       "message": "Data has been processed successfully!",
 *       "toastType": "success"
 *     }
 *   ]
 * }
 * ```
 *
 * @example API Response with Multiple Actions:
 * ```json
 * {
 *   "status": "success",
 *   "nextAction": [
 *     {
 *       "type": "showToast",
 *       "message": "Processing complete!",
 *       "toastType": "success"
 *     },
 *     {
 *       "type": "sendMessage",
 *       "message": "Would you like to export the results?"
 *     }
 *   ]
 * }
 * ```
 *
 * @features
 * - Progressive streaming rendering: displays partial rows as they arrive
 * - Full-screen mode with ESC/click-backdrop/button exit
 * - Inline editing with react-spreadsheet (default: all cells editable)
 * - Flexible edit control: editable (all cells), editableHeader (header row)
 * - Hidden columns support: hide by index (hiddenColumns) or name (hiddenColumnNames)
 * - Copy to clipboard (CSV format with proper escaping)
 * - Download as CSV file (standard CSV format)
 * - Multiple action buttons support with custom text, icon, variant
 * - Custom action callback support
 * - Post-action messaging (auto-send message)
 * - API response nextAction support
 * - Statistics bar (rows × columns, cells with data)
 * - Dark/Light mode support
 * - Portal-based fullscreen (z-index independent)
 *
 * @streaming Progressive Rendering
 * Content arrives in chunks during AI streaming:
 * 1. Try complete JSON parse first
 * 2. If incomplete, extract complete rows from partial JSON
 * 3. Render available rows immediately (progressive display)
 * 4. Update as more data arrives
 *
 * @remarks
 * - Content is auto-trimmed (ReactMarkdown removes ``` markers)
 * - Handles trailing content after JSON (e.g., ``` closing tags)
 * - Uses createPortal for fullscreen to escape parent DOM constraints
 * - Spreadsheet state persists during editing until action/unmount
 * - Default: all cells editable (editable: true, editableHeader: true)
 * - Set editable: false for complete read-only mode
 * - Set editableHeader: false to protect header row only
 * - Hidden columns only affect display, original data remains intact
 */
import type { CellBase, DataEditorProps, DataViewerProps, Matrix } from 'react-spreadsheet'
import type { ActionConfig, PostAction } from './hooks/use-editor-common'
import { RiDownloadLine, RiFullscreenExitLine, RiFullscreenLine, RiLoader2Line, RiSaveLine, RiUploadLine } from '@remixicon/react'
import copy from 'copy-to-clipboard'
import * as React from 'react'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { usePapaParse } from 'react-papaparse'
import Spreadsheet from 'react-spreadsheet'
import Button from '@/app/components/base/button'
import ContextMenu from '@/app/components/base/context-menu'
import { Copy, CopyCheck } from '@/app/components/base/icons/src/vender/line/files'
import Toast from '@/app/components/base/toast'
import {
  AlertDialog,
  AlertDialogActions,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@/app/components/base/ui/alert-dialog'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/app/components/base/ui/tooltip'
import { cn } from '@/utils/classnames'
import { useChatContext } from '../chat/chat/context'
import { useCsvOperations } from './hooks/use-csv-operations'
import {

  executeApiAction,
  executeCustomAction,
  loadPersistedData,
  useDataPersistence,
  useEscapeFullscreen,
} from './hooks/use-editor-common'

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Component props
 * @property content - Raw markdown code block content (JSON string)
 * @property isDarkMode - Theme mode for styling
 * @property onCopyData - Optional callback to format data for clipboard (returns string to copy)
 * @property messageId - Optional message ID for persisting data
 */
type ExcelViewerProps = {
  content: string
  isDarkMode: boolean
  onCopyData?: (data: string[][]) => string
  messageId?: string
}

type ExcelConfig = {
  url?: string
  data?: string[][]
  editable?: boolean
  editableHeader?: boolean
  hiddenColumns?: number[] // Array of column indices to hide (0-based)
  hiddenColumnNames?: string[] // Array of column header names to hide
  actions?: ActionConfig<string[][]>[] // Action buttons
  onCopyData?: (data: string[][]) => string
  postAction?: PostAction
}

/**
 * Internal cell type used by react-spreadsheet library
 *
 * @property value - Cell content
 * @property readOnly - Whether the cell is read-only (official react-spreadsheet API)
 */
type SpreadsheetCell = CellBase<string> & {
  value: string
  readOnly?: boolean
}

// ============================================================================
// Pure helper functions (defined outside component to avoid re-creation)
// ============================================================================

/**
 * Extract complete rows from partially-streamed JSON array content.
 * Enables real-time rendering during AI streaming responses.
 */
function extractCompleteRows(arrayContent: string): string[][] {
  const completeRows: string[][] = []
  let currentPos = 0

  while (currentPos < arrayContent.length) {
    const rowStart = arrayContent.indexOf('[', currentPos)
    if (rowStart === -1)
      break

    let bracketCount = 1
    let rowEnd = rowStart + 1
    let inString = false
    let escapeNext = false

    while (rowEnd < arrayContent.length && bracketCount > 0) {
      const char = arrayContent[rowEnd]

      if (escapeNext) {
        escapeNext = false
      }
      else if (char === '\\') {
        escapeNext = true
      }
      else if (char === '"') {
        inString = !inString
      }
      else if (!inString) {
        if (char === '[')
          bracketCount++
        else if (char === ']')
          bracketCount--
      }

      rowEnd++
    }

    if (bracketCount === 0) {
      try {
        const rowJson = arrayContent.substring(rowStart, rowEnd)
        const row = JSON.parse(rowJson) as string[]
        completeRows.push(row)
        currentPos = rowEnd
      }
      catch {
        currentPos = rowEnd
      }
    }
    else {
      break
    }
  }

  return completeRows
}

/**
 * Parse ExcelConfig from raw content string.
 * Returns the parsed config and whether streaming is still in progress.
 */
function parseExcelConfig(content: string): { config: ExcelConfig | null, isStreaming: boolean, parseError: boolean } {
  if (!content || !content.trim())
    return { config: null, isStreaming: false, parseError: false }

  try {
    const trimmedContent = content.trim()
    let jsonContent = trimmedContent
    const lastBraceIndex = Math.max(
      trimmedContent.lastIndexOf('}'),
      trimmedContent.lastIndexOf(']'),
    )

    if (lastBraceIndex !== -1 && lastBraceIndex < trimmedContent.length - 1)
      jsonContent = trimmedContent.substring(0, lastBraceIndex + 1)

    try {
      const parsedConfig = JSON.parse(jsonContent) as ExcelConfig
      return { config: parsedConfig, isStreaming: false, parseError: false }
    }
    catch {
      // JSON not complete yet, try progressive parsing
    }

    const dataMatch = trimmedContent.match(/"data"\s*:\s*\[([\s\S]*)/)
    if (dataMatch) {
      const completeRows = extractCompleteRows(dataMatch[1])
      if (completeRows.length > 0) {
        return {
          config: { data: completeRows, editable: true },
          isStreaming: true,
          parseError: false,
        }
      }
    }

    if (trimmedContent.endsWith('}') || trimmedContent.endsWith(']'))
      return { config: null, isStreaming: false, parseError: true }

    return { config: null, isStreaming: true, parseError: false }
  }
  catch {
    return { config: null, isStreaming: false, parseError: false }
  }
}

// ============================================================================
// Sub-components (defined outside ExcelViewer to satisfy react/no-nested-component-definitions)
// ============================================================================

/**
 * Custom DataEditor for multiline text support in spreadsheet cells.
 */
const MultilineDataEditor: React.FC<DataEditorProps<SpreadsheetCell>> = ({ onChange, cell }) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const value = String(cell?.value ?? '')

  const handleChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    onChange({ ...cell, value: event.target.value } as SpreadsheetCell)
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && event.altKey) {
      event.preventDefault()
      const textarea = event.currentTarget
      const start = textarea.selectionStart
      const end = textarea.selectionEnd
      const currentValue = textarea.value
      const newValue = `${currentValue.substring(0, start)}\n${currentValue.substring(end)}`
      onChange({ ...cell, value: newValue } as SpreadsheetCell)
      const cursorPosition = start + 1
      setTimeout(() => {
        textarea.selectionStart = cursorPosition
        textarea.selectionEnd = cursorPosition
      }, 0)
    }
    if (event.key === 'Escape')
      event.stopPropagation()
  }

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.focus()
      const length = textareaRef.current.value.length
      textareaRef.current.setSelectionRange(length, length)
    }
  }, [])

  return (
    <div className="Spreadsheet__data-editor">
      <textarea
        ref={textareaRef}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        value={value}
        rows={1}
        className="w-full resize-none overflow-hidden p-1"
        style={{
          minHeight: '100%',
          border: 'none',
          outline: 'none',
          fontFamily: 'inherit',
          fontSize: 'inherit',
          lineHeight: 'inherit',
        }}
      />
    </div>
  )
}

/**
 * Custom DataViewer for multiline text rendering in spreadsheet cells.
 */
const MultilineDataViewer: React.FC<DataViewerProps<SpreadsheetCell>> = ({ cell }) => {
  const value = cell?.value ?? ''
  const valueStr = String(value)

  if (valueStr.includes('\n')) {
    return (
      <>
        {valueStr.split('\n').map((line, index, array) => (
          <span key={index}>
            {line}
            {index < array.length - 1 && <br />}
          </span>
        ))}
      </>
    )
  }

  return <>{valueStr}</>
}

// ============================================================================
// Reducer for data-loading state (avoids direct setState in useEffect)
// ============================================================================
type DataLoadAction
  = | { type: 'LOAD_START' }
    | { type: 'LOAD_SUCCESS', data: Matrix<SpreadsheetCell> }
    | { type: 'LOAD_ERROR' }
    | { type: 'SET_DATA', data: Matrix<SpreadsheetCell> }

type DataLoadState = {
  loading: boolean
  data: Matrix<SpreadsheetCell>
}

function dataLoadReducer(state: DataLoadState, action: DataLoadAction): DataLoadState {
  switch (action.type) {
    case 'LOAD_START':
      return { ...state, loading: true }
    case 'LOAD_SUCCESS':
      return { loading: false, data: action.data }
    case 'LOAD_ERROR':
      return { loading: false, data: [[{ value: '', readOnly: false }]] }
    case 'SET_DATA':
      return { ...state, data: action.data }
    default:
      return state
  }
}

const ExcelViewer = memo(({ content, isDarkMode, onCopyData, messageId }: ExcelViewerProps) => {
  const { t } = useTranslation()
  const { onSend } = useChatContext()
  const [executingActionIndex, setExecutingActionIndex] = useState<number | null>(null)
  const [{ loading, data }, dispatch] = React.useReducer(dataLoadReducer, { loading: false, data: [[]] })
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [isCopied, setIsCopied] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [confirmingActionIndex, setConfirmingActionIndex] = useState<number>(0)
  const { readRemoteFile } = usePapaParse()
  const readRemoteFileRef = useRef(readRemoteFile)
  const { convertToCSV, convertToRawData, handleDownload: csvDownload, handleUpload: csvUpload } = useCsvOperations()
  // Update ref when readRemoteFile changes
  useEffect(() => {
    readRemoteFileRef.current = readRemoteFile
  }, [readRemoteFile])

  const [activeCell, setActiveCell] = useState<{ row: number, column: number } | null>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number, y: number, type: 'row' | 'column', index: number } | null>(null)
  const spreadsheetRef = useRef<HTMLDivElement>(null)
  const hasLoadedPersistedDataRef = useRef(false) // Track if we've loaded from localStorage
  const isStreamingRef = useRef(false) // Track if content is still streaming

  // Handle ESC key to exit fullscreen
  useEscapeFullscreen(isFullscreen, setIsFullscreen)

  // Parse configuration from content using pure function; config is fully derived from content
  const parsedResult = useMemo(() => parseExcelConfig(content), [content])

  // config is derived state – no useState needed, useMemo is sufficient
  const config = useMemo(() => parsedResult.config, [parsedResult.config])

  // Sync streaming flag and show toast on parse error (no setState calls here)
  useEffect(() => {
    isStreamingRef.current = parsedResult.isStreaming
    if (parsedResult.parseError) {
      console.error('[ExcelViewer] Parse error for content:', content)
      Toast.notify({
        type: 'error',
        message: t('chat.excelViewer.invalidFormat', { ns: 'common' }),
      })
    }
  }, [parsedResult, content, t])

  // Load data from URL or inline; dispatch keeps setState out of useEffect
  const loadData = useCallback((cfg: ExcelConfig) => {
    const isEditable = cfg.editable !== false
    const isEditableHeader = cfg.editableHeader !== false

    const toSpreadsheetData = (rawData: string[][]): Matrix<SpreadsheetCell> =>
      rawData.map((row, rowIndex) =>
        row.map(cellValue => ({
          value: cellValue || '',
          readOnly: !isEditable || (rowIndex === 0 && !isEditableHeader),
        })),
      )

    const shouldLoadPersisted = !isStreamingRef.current && !hasLoadedPersistedDataRef.current && messageId

    if (shouldLoadPersisted) {
      const persisted = loadPersistedData<string[][]>(messageId, 'excel-data')
      if (persisted) {
        dispatch({ type: 'SET_DATA', data: toSpreadsheetData(persisted) })
        hasLoadedPersistedDataRef.current = true
        return
      }
    }

    if (cfg.url) {
      dispatch({ type: 'LOAD_START' })
      readRemoteFileRef.current(cfg.url, {
        download: true,
        complete: (results) => {
          const rawData = results.data as string[][]
          dispatch({ type: 'LOAD_SUCCESS', data: toSpreadsheetData(rawData) })
          hasLoadedPersistedDataRef.current = true
        },
        error: (err: Error) => {
          Toast.notify({
            type: 'error',
            message: `${t('chat.excelViewer.loadFailed', { ns: 'common' })}: ${err.message}`,
          })
          dispatch({ type: 'LOAD_ERROR' })
          hasLoadedPersistedDataRef.current = true
        },
      })
    }
    else if (cfg.data) {
      dispatch({ type: 'SET_DATA', data: toSpreadsheetData(cfg.data) })
      hasLoadedPersistedDataRef.current = true
    }
    else {
      Toast.notify({
        type: 'error',
        message: t('chat.excelViewer.invalidFormat', { ns: 'common' }),
      })
      dispatch({ type: 'LOAD_ERROR' })
      hasLoadedPersistedDataRef.current = true
    }
  }, [messageId, t])

  useEffect(() => {
    if (!config)
      return
    loadData(config)
  }, [config, loadData])

  // Calculate hidden column indices from both hiddenColumns and hiddenColumnNames
  const hiddenColumnIndices = useMemo(() => {
    const indices = new Set<number>()

    // Add indices from hiddenColumns
    if (config?.hiddenColumns)
      config.hiddenColumns.forEach(index => indices.add(index))

    // Add indices from hiddenColumnNames by matching header row
    if (config?.hiddenColumnNames && data.length > 0) {
      const headerRow = data[0]
      config.hiddenColumnNames.forEach((name) => {
        const index = headerRow.findIndex(cell => cell?.value === name)
        if (index !== -1)
          indices.add(index)
      })
    }

    return Array.from(indices)
  }, [config?.hiddenColumns, config?.hiddenColumnNames, data])

  // Filter out hidden columns from data
  const displayData = useMemo(() => {
    if (hiddenColumnIndices.length === 0)
      return data

    return data.map(row =>
      row.filter((_, colIndex) => !hiddenColumnIndices.includes(colIndex)),
    )
  }, [data, hiddenColumnIndices])

  // Handle data changes from Spreadsheet editor
  // Merge edited displayData back into full data (preserving hidden columns)
  const handleDataChange = useCallback((newDisplayData: Matrix<SpreadsheetCell>) => {
    if (hiddenColumnIndices.length === 0) {
      // No hidden columns, direct update
      dispatch({ type: 'SET_DATA', data: newDisplayData })
      return
    }

    // Merge display data back with hidden columns
    const mergedData = data.map((row, rowIndex) => {
      const newRow = [...row]
      let displayColIndex = 0

      for (let colIndex = 0; colIndex < row.length; colIndex++) {
        if (!hiddenColumnIndices.includes(colIndex)) {
          // Update visible column from displayData
          if (newDisplayData[rowIndex]?.[displayColIndex] !== undefined)
            newRow[colIndex] = newDisplayData[rowIndex][displayColIndex]

          displayColIndex++
        }
        // Keep hidden column unchanged
      }

      return newRow
    })

    dispatch({ type: 'SET_DATA', data: mergedData })
  }, [data, hiddenColumnIndices])

  // Convert current data to raw format for persistence
  const rawDataForPersistence = useMemo(() => {
    if (!data || data.length === 0 || (data.length === 1 && data[0].length === 0))
      return null
    return data.map(row => row.map(cell => cell?.value || ''))
  }, [data])

  // Persist data changes to localStorage
  useDataPersistence(
    rawDataForPersistence,
    config,
    isStreamingRef.current,
    hasLoadedPersistedDataRef.current,
    messageId,
    'excel-data',
  )

  // Note: convertToCSV is now provided by useCsvOperations hook

  // Handle copy to clipboard (uses custom formatter if provided)
  // IMPORTANT: Always copy complete data including hidden columns
  const handleCopy = useCallback(() => {
    const rawData = convertToRawData(data)

    // Use custom copy formatter if provided (from props or config)
    const copyText = (onCopyData || config?.onCopyData)?.(rawData) || convertToCSV(rawData)

    const success = copy(copyText)
    if (success) {
      setIsCopied(true)
      // Reset copied state after 2 seconds
      setTimeout(() => setIsCopied(false), 2000)
    }
  }, [data, onCopyData, config, convertToRawData, convertToCSV])

  // Pre-compute translations for CSV upload to avoid type issues
  const uploadTranslations = useMemo(() => ({
    'chat.excelViewer.uploadEmptyFile': t('chat.excelViewer.uploadEmptyFile', { ns: 'common' }),
    'chat.excelViewer.uploadSuccess': t('chat.excelViewer.uploadSuccess', { ns: 'common' }),
    'chat.excelViewer.uploadFailed': t('chat.excelViewer.uploadFailed', { ns: 'common' }),
  }), [t])

  // Handle file upload to replace data
  const handleUpload = useCallback(() => {
    const translateWrapper = (key: string, _options?: { ns?: string }): string => {
      // Strip ns option and just use the key from our pre-computed translations
      return uploadTranslations[key as keyof typeof uploadTranslations] || key
    }
    csvUpload((newData: Matrix<SpreadsheetCell>) => dispatch({ type: 'SET_DATA', data: newData }), config || undefined, translateWrapper)
  }, [csvUpload, config, uploadTranslations])

  // Handle download as CSV file
  // IMPORTANT: Download complete data including hidden columns
  const handleDownload = useCallback(() => {
    csvDownload(data, `excel-data-${Date.now()}.csv`)
  }, [data, csvDownload])

  const handleAction = useCallback(async (actionIndex: number = 0) => {
    const currentAction = config?.actions?.[actionIndex]
    if (!currentAction)
      return

    const rawData = convertToRawData(data)

    // Custom callback
    if (currentAction.onSuccess) {
      await executeCustomAction(
        rawData,
        currentAction,
        config,
        onSend,
        setShowConfirm,
        t('chat.excelViewer.actionFailed', { ns: 'common' }),
      )
      setExecutingActionIndex(null)
      return
    }

    // Execute API action
    if (currentAction.url) {
      setExecutingActionIndex(actionIndex)
      await executeApiAction(
        rawData,
        currentAction,
        config,
        onSend,
        (executing: boolean) => {
          if (!executing)
            setExecutingActionIndex(null)
        },
        setShowConfirm,
        'data',
        t('api.actionSuccess', { ns: 'common' }),
        t('chat.excelViewer.actionFailed', { ns: 'common' }),
      )
    }
  }, [config, data, convertToRawData, onSend, t])

  // Handle keyboard events for auto-adding rows/columns
  const handleKeyDown = useCallback((event: React.KeyboardEvent) => {
    const isEditable = config?.editable !== false
    if (!isEditable || !activeCell)
      return

    const rowCount = data.length
    const columnCount = data[0]?.length || 0

    // Enter key: add new row if on last row
    if (event.key === 'Enter' && activeCell.row === rowCount - 1) {
      event.preventDefault()
      const newRow = Array.from({ length: columnCount }).fill(null).map(() => ({ value: '', readOnly: false }))
      dispatch({ type: 'SET_DATA', data: [...data, newRow] })
    }

    // Tab key: add new column if on last column
    if (event.key === 'Tab' && !event.shiftKey && activeCell.column === columnCount - 1) {
      event.preventDefault()
      const newData = data.map(row => [...row, { value: '', readOnly: false }])
      dispatch({ type: 'SET_DATA', data: newData })
    }
  }, [config, activeCell, data])

  // Helper function to map display column index to actual data column index
  const mapDisplayToActualColumnIndex = useCallback((displayColIndex: number): number => {
    if (hiddenColumnIndices.length === 0)
      return displayColIndex

    let visibleCount = 0
    const totalColumns = data[0]?.length || 0
    for (let i = 0; i < totalColumns; i++) {
      if (hiddenColumnIndices.includes(i))
        continue

      if (visibleCount === displayColIndex)
        return i

      visibleCount++
    }
    return displayColIndex
  }, [hiddenColumnIndices, data])

  // Handle right-click context menu
  const handleContextMenu = useCallback((event: React.MouseEvent) => {
    const isEditable = config?.editable !== false
    if (!isEditable)
      return

    const target = event.target as HTMLElement

    // Check if clicked on row or column header by checking classes and data attributes
    // react-spreadsheet uses th elements for headers
    const thElement = target.closest('th')
    if (!thElement)
      return

    event.preventDefault()
    event.stopPropagation()

    // Get the table to find row/column index
    const table = thElement.closest('table')
    if (!table)
      return

    const row = thElement.parentElement as HTMLTableRowElement
    if (!row)
      return

    // Check if it's a row header (first cell in row, except the first row which contains column headers)
    const cellIndex = Array.from(row.children).indexOf(thElement)
    const rowIndex = Array.from(table.querySelectorAll('tr')).indexOf(row)

    // First row is column headers, first column is row headers
    if (rowIndex === 0 && cellIndex > 0) {
      // Column header clicked - cellIndex is based on displayData, need to map to actual data index
      const displayColIndex = cellIndex - 1
      const actualColIndex = mapDisplayToActualColumnIndex(displayColIndex)
      setContextMenu({ x: event.clientX, y: event.clientY, type: 'column', index: actualColIndex })
    }
    else if (cellIndex === 0 && rowIndex > 0) {
      // Row header clicked
      setContextMenu({ x: event.clientX, y: event.clientY, type: 'row', index: rowIndex - 1 })
    }
  }, [config, mapDisplayToActualColumnIndex])

  // Insert row before
  const insertRowBefore = useCallback((index: number) => {
    const columnCount = data[0]?.length || 0
    const newRow = Array.from({ length: columnCount }).fill(null).map(() => ({ value: '', readOnly: false }))
    const newData = [...data]
    newData.splice(index, 0, newRow)
    dispatch({ type: 'SET_DATA', data: newData })
    setContextMenu(null)
  }, [data])

  // Insert row after
  const insertRowAfter = useCallback((index: number) => {
    const columnCount = data[0]?.length || 0
    const newRow = Array.from({ length: columnCount }).fill(null).map(() => ({ value: '', readOnly: false }))
    const newData = [...data]
    newData.splice(index + 1, 0, newRow)
    dispatch({ type: 'SET_DATA', data: newData })
    setContextMenu(null)
  }, [data])

  // Delete row
  const deleteRow = useCallback((index: number) => {
    if (data.length <= 1)
      return // Keep at least one row
    const newData = data.filter((_, i) => i !== index)
    dispatch({ type: 'SET_DATA', data: newData })
    setContextMenu(null)
  }, [data])

  // Insert column before
  const insertColumnBefore = useCallback((index: number) => {
    const newData = data.map((row) => {
      const newRow = [...row]
      newRow.splice(index, 0, { value: '', readOnly: false })
      return newRow
    })
    dispatch({ type: 'SET_DATA', data: newData })
    setContextMenu(null)
  }, [data])

  // Insert column after
  const insertColumnAfter = useCallback((index: number) => {
    const newData = data.map((row) => {
      const newRow = [...row]
      newRow.splice(index + 1, 0, { value: '', readOnly: false })
      return newRow
    })
    dispatch({ type: 'SET_DATA', data: newData })
    setContextMenu(null)
  }, [data])

  // Delete column
  const deleteColumn = useCallback((index: number) => {
    if (data[0]?.length <= 1)
      return // Keep at least one column
    const newData = data.map(row => row.filter((_, i) => i !== index))
    dispatch({ type: 'SET_DATA', data: newData })
    setContextMenu(null)
  }, [data])

  // Get context menu items based on type (not memoized to avoid dependency chain)
  const getContextMenuItems = (type: 'row' | 'column', index: number) => {
    if (type === 'row') {
      return [
        { label: t('chat.excelViewer.insertRowBefore', { ns: 'common' }), onClick: () => insertRowBefore(index) },
        { label: t('chat.excelViewer.insertRowAfter', { ns: 'common' }), onClick: () => insertRowAfter(index) },
        { label: t('chat.excelViewer.deleteRow', { ns: 'common' }), onClick: () => deleteRow(index), isDanger: true },
      ]
    }
    else {
      return [
        { label: t('chat.excelViewer.insertColumnBefore', { ns: 'common' }), onClick: () => insertColumnBefore(index) },
        { label: t('chat.excelViewer.insertColumnAfter', { ns: 'common' }), onClick: () => insertColumnAfter(index) },
        { label: t('chat.excelViewer.deleteColumn', { ns: 'common' }), onClick: () => deleteColumn(index), isDanger: true },
      ]
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[200px] items-center justify-center">
        <RiLoader2Line className="h-6 w-6 animate-spin text-text-tertiary" />
        <span className="ml-2 text-sm text-text-secondary">{t('chat.excelViewer.loadingData', { ns: 'common' })}</span>
      </div>
    )
  }

  if (!data || data.length === 0) {
    return (
      <div className="rounded-lg border border-divider-subtle bg-background-section-burn p-4">
        <div className="text-sm text-text-secondary">{t('chat.excelViewer.noData', { ns: 'common' })}</div>
      </div>
    )
  }

  // Calculate statistics (use original data, not display data)
  const rowCount = data.length
  const columnCount = data[0]?.length || 0
  const nonEmptyCells = data.reduce((count, row) => {
    return count + row.filter((cell) => {
      if (!cell?.value)
        return false
      const valueStr = String(cell.value)
      return valueStr.trim() !== ''
    }).length
  }, 0)

  // Create a reusable toolbar component
  const renderToolbar = (isFullscreenView = false) => (
    <div
      className="flex items-center justify-between border-b border-divider-subtle bg-background-section-burn p-2"
    >
      <div className="text-text-secondary system-xs-semibold-uppercase">
        {t('chat.excelViewer.title', { ns: 'common' })}
      </div>
      <div className="flex items-center gap-2">
        {/* Copy button */}
        <Tooltip>
          <TooltipTrigger
            render={(
              <button
                onClick={handleCopy}
                className="flex h-7 items-center gap-1 rounded-md px-2 transition-colors hover:bg-state-base-hover"
              />
            )}
          >
            {isCopied
              ? (
                  <CopyCheck className="h-3.5 w-3.5 text-text-tertiary" />
                )
              : (
                  <Copy className="h-3.5 w-3.5 text-text-tertiary" />
                )}
          </TooltipTrigger>
          <TooltipContent>
            {isCopied ? t('chat.excelViewer.copied', { ns: 'common' }) : t('chat.excelViewer.copyData', { ns: 'common' })}
          </TooltipContent>
        </Tooltip>
        {/* Upload button */}
        <Tooltip>
          <TooltipTrigger
            render={(
              <button
                onClick={handleUpload}
                className="flex h-7 items-center gap-1 rounded-md px-2 transition-colors hover:bg-state-base-hover"
              />
            )}
          >
            <RiUploadLine className="h-3.5 w-3.5 text-text-tertiary" />
          </TooltipTrigger>
          <TooltipContent>{t('chat.excelViewer.upload', { ns: 'common' })}</TooltipContent>
        </Tooltip>
        {/* Download button */}
        <Tooltip>
          <TooltipTrigger
            render={(
              <button
                onClick={handleDownload}
                className="flex h-7 items-center gap-1 rounded-md px-2 transition-colors hover:bg-state-base-hover"
              />
            )}
          >
            <RiDownloadLine className="h-3.5 w-3.5 text-text-tertiary" />
          </TooltipTrigger>
          <TooltipContent>{t('chat.excelViewer.download', { ns: 'common' })}</TooltipContent>
        </Tooltip>
        {/* Fullscreen toggle */}
        <Button
          variant="secondary"
          size="small"
          onClick={() => isFullscreenView ? setIsFullscreen(false) : setIsFullscreen(true)}
          className="flex items-center gap-1"
        >
          {isFullscreenView
            ? (
                <>
                  <RiFullscreenExitLine className="h-4 w-4" />
                  <span>{t('chat.excelViewer.exitFullscreen', { ns: 'common' })}</span>
                </>
              )
            : (
                <>
                  <RiFullscreenLine className="h-4 w-4" />
                  <span>{t('chat.excelViewer.fullscreen', { ns: 'common' })}</span>
                </>
              )}
        </Button>
        {/* Action buttons */}
        {config?.actions && config.actions.length > 0 && (
          <>
            {config.actions.map((action, index) => {
              const isExecuting = executingActionIndex === index
              return (
                <Button
                  key={index}
                  variant={action?.buttonVariant || 'primary'}
                  size="small"
                  onClick={() => {
                    setConfirmingActionIndex(index)
                    setShowConfirm(true)
                  }}
                  disabled={isExecuting || executingActionIndex !== null}
                  className="flex items-center gap-1"
                >
                  {isExecuting
                    ? (
                        <RiLoader2Line className="h-4 w-4 animate-spin" />
                      )
                    : (
                  // Render appropriate icon based on buttonIcon config
                        (() => {
                          const iconType = action?.buttonIcon || 'save'

                          switch (iconType) {
                            case 'submit':
                              return <RiSaveLine className="h-4 w-4" />
                            case 'send':
                              return <RiSaveLine className="h-4 w-4" />
                            case 'upload':
                              return <RiSaveLine className="h-4 w-4" />
                            case 'confirm':
                              return <RiSaveLine className="h-4 w-4" />
                            case 'save':
                            default:
                              return <RiSaveLine className="h-4 w-4" />
                          }
                        })()
                      )}
                  <span>
                    {isExecuting ? t('chat.excelViewer.executing', { ns: 'common' }) : (action?.buttonText || t('chat.excelViewer.submit', { ns: 'common' }))}
                  </span>
                </Button>
              )
            })}
          </>
        )}
      </div>
    </div>
  )

  // Create a reusable status bar component
  const renderStatusBar = () => (
    <div
      className="flex items-center justify-start border-t border-divider-subtle bg-background-section-burn px-3 py-1.5"
    >
      <div className="flex items-center gap-4 text-xs text-text-tertiary">
        <span>
          {rowCount}
          {' '}
          {t('chat.excelViewer.rows', { ns: 'common' })}
          {' '}
          ×
          {' '}
          {columnCount}
          {' '}
          {t('chat.excelViewer.columns', { ns: 'common' })}
        </span>
        {nonEmptyCells > 0 && (
          <span>
            {nonEmptyCells}
            {' '}
            {t('chat.excelViewer.cellsWithData', { ns: 'common' })}
          </span>
        )}
      </div>
    </div>
  )

  // Render spreadsheet content (reusable for both normal and fullscreen views)
  const renderSpreadsheetContent = () => (
    <>
      {/* Spreadsheet */}
      <div
        ref={spreadsheetRef}
        className={cn(
          'overflow-auto',
          !isFullscreen && 'p-4',
          isDarkMode ? 'spreadsheet-dark' : 'spreadsheet-light',
        )}
        style={!isFullscreen ? { maxHeight: '500px' } : undefined}
        onContextMenu={handleContextMenu}
        onKeyDown={handleKeyDown}
      >
        <Spreadsheet
          data={displayData}
          onChange={handleDataChange}
          onActivate={setActiveCell}
          DataEditor={MultilineDataEditor}
          DataViewer={MultilineDataViewer}
        />
      </div>
      {/* Status bar */}
      {renderStatusBar()}
      {/* Context menu */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={getContextMenuItems(contextMenu.type, contextMenu.index)}
          onClose={() => setContextMenu(null)}
        />
      )}
    </>
  )

  // Render normal (non-fullscreen) view
  const renderNormalView = () => (
    <div className="rounded-lg border border-divider-subtle bg-components-input-bg-normal">
      {/* Toolbar */}
      {renderToolbar(false)}
      {renderSpreadsheetContent()}
    </div>
  )

  // Render fullscreen view using portal
  const renderFullscreenView = () => createPortal(
    <div className="fixed inset-0 z-[10000000] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      {/* Excel viewer container */}
      <div
        style={{ padding: '5px' }}
        className="bg-background-default-normal relative flex h-full max-w-full flex-col rounded-lg border border-divider-subtle"
        onClick={(e) => {
          // Prevent closing when clicking inside the container
          e.stopPropagation()
        }}
      >
        {/* Toolbar */}
        {renderToolbar(true)}
        {renderSpreadsheetContent()}
      </div>
      {/* Click outside to close */}
      <div
        className="fixed inset-0 -z-10"
        onClick={() => setIsFullscreen(false)}
        onContextMenu={e => e.preventDefault()}
      />
    </div>,
    document.body,
  )

  // Main render
  return (
    <>
      {renderNormalView()}
      {isFullscreen && renderFullscreenView()}

      {/* Action confirmation dialog */}
      <AlertDialog open={showConfirm} onOpenChange={setShowConfirm}>
        <AlertDialogContent>
          <div className="p-6">
            <AlertDialogTitle className="mb-2 text-text-primary title-2xl-semi-bold">
              {t('chat.excelViewer.actionConfirmTitle', { ns: 'common' })}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-text-secondary body-md-regular">
              {t('chat.excelViewer.actionConfirmContent', { ns: 'common' })}
            </AlertDialogDescription>
          </div>
          <AlertDialogActions>
            <AlertDialogCancelButton variant="secondary" onClick={() => setShowConfirm(false)}>
              {t('chat.excelViewer.cancelButton', { ns: 'common' })}
            </AlertDialogCancelButton>
            <AlertDialogConfirmButton
              loading={executingActionIndex !== null}
              onClick={() => handleAction(confirmingActionIndex)}
            >
              {t('chat.excelViewer.actionConfirmButton', { ns: 'common' })}
            </AlertDialogConfirmButton>
          </AlertDialogActions>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
})

ExcelViewer.displayName = 'ExcelViewer'

export default ExcelViewer
