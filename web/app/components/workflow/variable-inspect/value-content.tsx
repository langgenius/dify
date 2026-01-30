import type { VarInspectValue } from './value-types'
import type { FileEntity } from '@/app/components/base/file-uploader/types'
import type { VarInInspect } from '@/types/workflow'
import { useDebounceFn } from 'ahooks'
import * as React from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { FileUploaderInAttachmentWrapper } from '@/app/components/base/file-uploader'
import { getProcessedFiles, getProcessedFilesFromResponse } from '@/app/components/base/file-uploader/utils'
import { FILE_EXTS } from '@/app/components/base/prompt-editor/constants'
import Textarea from '@/app/components/base/textarea'
import ErrorMessage from '@/app/components/workflow/nodes/llm/components/json-schema-config-modal/error-message'
import SchemaEditor from '@/app/components/workflow/nodes/llm/components/json-schema-config-modal/schema-editor'
import {
  checkJsonSchemaDepth,
  getValidationErrorMessage,
  validateSchemaAgainstDraft7,
} from '@/app/components/workflow/nodes/llm/utils'
import { useStore } from '@/app/components/workflow/store'
import { SupportUploadFileTypes, VarType } from '@/app/components/workflow/types'
import {
  validateJSONSchema,
} from '@/app/components/workflow/variable-inspect/utils'
import { JSON_SCHEMA_MAX_DEPTH } from '@/config'
import { TransferMethod } from '@/types/app'
import { VarInInspectType } from '@/types/workflow'
import { cn } from '@/utils/classnames'
import { PreviewMode } from '../../base/features/types'
import BoolValue from '../panel/chat-variable-panel/components/bool-value'
import DisplayContent from './display-content'
import LargeDataAlert from './large-data-alert'
import { CHUNK_SCHEMA_TYPES, PreviewType } from './types'

type Props = {
  currentVar: VarInInspect
  handleValueChange: (varId: string, value: VarInspectValue) => void
  isTruncated: boolean
}

const textValueTypes = new Set<VarType>([VarType.secret, VarType.string, VarType.number])
const jsonValueTypes = new Set<VarType>([
  VarType.object,
  VarType.arrayString,
  VarType.arrayNumber,
  VarType.arrayObject,
  VarType.arrayMessage,
  VarType.arrayAny,
])
const fileValueTypes = new Set<VarType>([VarType.file, VarType.arrayFile])

type EditorState = {
  textValue: string | number
  jsonValue: string
  fileValue: FileEntity[]
}

const formatFileValue = (value: VarInInspect, isSysFiles: boolean): FileEntity[] => {
  if (value.value_type === VarType.file)
    return value.value ? getProcessedFilesFromResponse([value.value]) : []
  if (value.value_type === VarType.arrayFile || (value.type === VarInInspectType.system && isSysFiles))
    return value.value && value.value.length > 0 ? getProcessedFilesFromResponse(value.value) : []
  return []
}

const ValueContent = ({
  currentVar,
  handleValueChange,
  isTruncated,
}: Props) => {
  const contentContainerRef = useRef<HTMLDivElement>(null)
  const errorMessageRef = useRef<HTMLDivElement>(null)
  const [editorHeight, setEditorHeight] = useState(0)
  const showTextEditor = textValueTypes.has(currentVar.value_type)
  const showBoolEditor = typeof currentVar.value === 'boolean'
  const showBoolArrayEditor = Array.isArray(currentVar.value) && currentVar.value.every(v => typeof v === 'boolean')
  const isSysFiles = currentVar.type === VarInInspectType.system && currentVar.name === 'files'
  const showJSONEditor = !isSysFiles && jsonValueTypes.has(currentVar.value_type)
  const showFileEditor = isSysFiles || fileValueTypes.has(currentVar.value_type)
  const textEditorDisabled = currentVar.type === VarInInspectType.environment || (currentVar.type === VarInInspectType.system && currentVar.name !== 'query' && currentVar.name !== 'files')
  const JSONEditorDisabled = currentVar.value_type === VarType.arrayAny
  const fileUploadConfig = useStore(s => s.fileUploadConfig)

  const hasChunks = useMemo(() => {
    if (!currentVar.schemaType)
      return false
    return CHUNK_SCHEMA_TYPES.includes(currentVar.schemaType)
  }, [currentVar.schemaType])

  const initialEditorState = useMemo<EditorState>(() => {
    const textValue = showTextEditor
      ? (
          currentVar.value_type === VarType.number
            ? JSON.stringify(currentVar.value)
            : (currentVar.value || '')
        )
      : ''
    const jsonValue = showJSONEditor
      ? (currentVar.value != null ? JSON.stringify(currentVar.value, null, 2) : '')
      : ''
    const fileValue = showFileEditor
      ? formatFileValue(currentVar, isSysFiles)
      : []
    return {
      textValue,
      jsonValue,
      fileValue,
    }
  }, [currentVar, isSysFiles, showFileEditor, showJSONEditor, showTextEditor])

  const [editorState, setEditorState] = useState<EditorState>(initialEditorState)
  const [parseError, setParseError] = useState<Error | null>(null)
  const [validationError, setValidationError] = useState<string>('')
  const { textValue, jsonValue, fileValue } = editorState

  const { run: debounceValueChange } = useDebounceFn(handleValueChange, { wait: 500 })

  // update default value when id or value changed
  useEffect(() => {
    setEditorState(initialEditorState)
  }, [initialEditorState])

  const handleTextChange = (value: string) => {
    if (isTruncated)
      return
    if (currentVar.value_type === VarType.string)
      setEditorState(prev => ({ ...prev, textValue: value }))

    if (currentVar.value_type === VarType.number) {
      if (/^-?\d+(\.)?(\d+)?$/.test(value))
        setEditorState(prev => ({ ...prev, textValue: Number.parseFloat(value) }))
    }
    const newValue = currentVar.value_type === VarType.number ? Number.parseFloat(value) : value
    debounceValueChange(currentVar.id, newValue)
  }

  const jsonValueValidate = (value: string, type: string) => {
    try {
      const newJSONSchema = JSON.parse(value)
      setParseError(null)
      const result = validateJSONSchema(newJSONSchema, type)
      if (!result.success) {
        setValidationError(result.error.message)
        return false
      }
      if (type === 'object' || type === 'array[object]') {
        const schemaDepth = checkJsonSchemaDepth(newJSONSchema)
        if (schemaDepth > JSON_SCHEMA_MAX_DEPTH) {
          setValidationError(`Schema exceeds maximum depth of ${JSON_SCHEMA_MAX_DEPTH}.`)
          return false
        }
        const validationErrors = validateSchemaAgainstDraft7(newJSONSchema)
        if (validationErrors.length > 0) {
          setValidationError(getValidationErrorMessage(validationErrors))
          return false
        }
      }
      setValidationError('')
      return true
    }
    catch (error) {
      setValidationError('')
      if (error instanceof Error) {
        setParseError(error)
        return false
      }
      else {
        setParseError(new Error('Invalid JSON'))
        return false
      }
    }
  }

  const handleEditorChange = (value: string) => {
    if (isTruncated)
      return
    setEditorState(prev => ({ ...prev, jsonValue: value }))
    if (jsonValueValidate(value, currentVar.value_type)) {
      const parsed = JSON.parse(value)
      debounceValueChange(currentVar.id, parsed)
    }
  }

  type ProcessedFile = ReturnType<typeof getProcessedFiles>[number]
  const fileValueValidate = (fileList: ProcessedFile[]) => fileList.every(file => file.upload_file_id)

  const handleFileChange = (value: FileEntity[]) => {
    setEditorState(prev => ({ ...prev, fileValue: value }))
    const processedFiles = getProcessedFiles(value)
    // check every file upload progress
    // invoke update api after every file uploaded
    if (!fileValueValidate(processedFiles))
      return
    if (currentVar.value_type === VarType.file)
      debounceValueChange(currentVar.id, processedFiles[0])
    if (currentVar.value_type === VarType.arrayFile || isSysFiles)
      debounceValueChange(currentVar.id, processedFiles)
  }

  // get editor height
  useEffect(() => {
    if (contentContainerRef.current && errorMessageRef.current) {
      const errorMessageObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const borderBoxSize = Array.isArray(entry.borderBoxSize)
            ? entry.borderBoxSize[0]
            : entry.borderBoxSize
          const errorHeight = borderBoxSize?.blockSize ?? entry.contentRect.height
          const containerHeight = contentContainerRef.current?.clientHeight ?? 0
          setEditorHeight(Math.max(containerHeight - errorHeight, 0))
        }
      })
      errorMessageObserver.observe(errorMessageRef.current)
      return () => {
        errorMessageObserver.disconnect()
      }
    }
  }, [setEditorHeight])

  return (
    <div
      ref={contentContainerRef}
      className="flex h-full flex-col"
    >
      <div className={cn('relative grow')} style={{ height: `${editorHeight}px` }}>
        {showTextEditor && (
          <>
            {isTruncated && <LargeDataAlert className="absolute left-3 right-3 top-1" />}
            {
              currentVar.value_type === VarType.string
                ? (
                    <DisplayContent
                      previewType={PreviewType.Markdown}
                      varType={currentVar.value_type}
                      mdString={typeof textValue === 'string' ? textValue : String(textValue)}
                      readonly={textEditorDisabled}
                      handleTextChange={handleTextChange}
                      className={cn(isTruncated && 'pt-[36px]')}
                    />
                  )
                : (
                    <Textarea
                      readOnly={textEditorDisabled}
                      disabled={textEditorDisabled || isTruncated}
                      className={cn('h-full', isTruncated && 'pt-[48px]')}
                      value={textValue}
                      onChange={e => handleTextChange(e.target.value)}
                    />
                  )
            }
          </>
        )}
        {showBoolEditor && (
          <div className="w-[295px]">
            <BoolValue
              value={currentVar.value as boolean}
              onChange={(newValue) => {
                debounceValueChange(currentVar.id, newValue)
              }}
            />
          </div>
        )}
        {
          showBoolArrayEditor && (
            <div className="w-[295px] space-y-1">
              {currentVar.value.map((v: boolean, i: number) => (
                <BoolValue
                  key={i}
                  value={v}
                  onChange={(newValue) => {
                    const newArray = [...(currentVar.value as boolean[])]
                    newArray[i] = newValue
                    debounceValueChange(currentVar.id, newArray)
                  }}
                />
              ))}
            </div>
          )
        }
        {showJSONEditor && (
          hasChunks
            ? (
                <DisplayContent
                  previewType={PreviewType.Chunks}
                  varType={currentVar.value_type}
                  schemaType={currentVar.schemaType ?? ''}
                  jsonString={jsonValue ?? '{}'}
                  readonly={JSONEditorDisabled}
                  handleEditorChange={handleEditorChange}
                />
              )
            : (
                <SchemaEditor
                  readonly={JSONEditorDisabled || isTruncated}
                  className="overflow-y-auto"
                  hideTopMenu
                  schema={jsonValue}
                  onUpdate={handleEditorChange}
                  isTruncated={isTruncated}
                />
              )
        )}
        {showFileEditor && (
          <div className="max-w-[460px]">
            <FileUploaderInAttachmentWrapper
              value={fileValue}
              onChange={handleFileChange}
              fileConfig={{
                allowed_file_types: [
                  SupportUploadFileTypes.image,
                  SupportUploadFileTypes.document,
                  SupportUploadFileTypes.audio,
                  SupportUploadFileTypes.video,
                ],
                allowed_file_extensions: [
                  ...FILE_EXTS[SupportUploadFileTypes.image],
                  ...FILE_EXTS[SupportUploadFileTypes.document],
                  ...FILE_EXTS[SupportUploadFileTypes.audio],
                  ...FILE_EXTS[SupportUploadFileTypes.video],
                ],
                allowed_file_upload_methods: [TransferMethod.local_file, TransferMethod.remote_url],
                number_limits: currentVar.value_type === VarType.file ? 1 : fileUploadConfig?.workflow_file_upload_limit || 5,
                fileUploadConfig,
                preview_config: {
                  mode: PreviewMode.NewPage,
                  file_type_list: ['application/pdf'],
                },
              }}
              isDisabled={textEditorDisabled}
            />
          </div>
        )}
      </div>
      <div ref={errorMessageRef} className="shrink-0">
        {parseError && <ErrorMessage className="mt-1" message={parseError.message} />}
        {validationError && <ErrorMessage className="mt-1" message={validationError} />}
      </div>
    </div>
  )
}

export default React.memo(ValueContent)
