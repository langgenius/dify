import { useEffect, useRef, useState } from 'react'
import { useDebounceFn } from 'ahooks'
import Textarea from '@/app/components/base/textarea'
import SchemaEditor from '@/app/components/workflow/nodes/llm/components/json-schema-config-modal/schema-editor'
import { FileUploaderInAttachmentWrapper } from '@/app/components/base/file-uploader'
import ErrorMessage from '@/app/components/workflow/nodes/llm/components/json-schema-config-modal/error-message'
import {
  checkJsonSchemaDepth,
  getValidationErrorMessage,
  validateSchemaAgainstDraft7,
} from '@/app/components/workflow/nodes/llm/utils'
import {
  validateJSONSchema,
} from '@/app/components/workflow/variable-inspect/utils'
import { useFeatures } from '@/app/components/base/features/hooks'
import { getProcessedFiles, getProcessedFilesFromResponse } from '@/app/components/base/file-uploader/utils'
import { JSON_SCHEMA_MAX_DEPTH } from '@/config'
import { TransferMethod } from '@/types/app'
import { FILE_EXTS } from '@/app/components/base/prompt-editor/constants'
import { SupportUploadFileTypes } from '@/app/components/workflow/types'
import type { VarInInspect } from '@/types/workflow'
import { VarInInspectType } from '@/types/workflow'
import cn from '@/utils/classnames'

type Props = {
  currentVar: VarInInspect
  handleValueChange: (varId: string, value: any) => void
}

const ValueContent = ({
  currentVar,
  handleValueChange,
}: Props) => {
  const contentContainerRef = useRef<HTMLDivElement>(null)
  const errorMessageRef = useRef<HTMLDivElement>(null)
  const [editorHeight, setEditorHeight] = useState(0)
  const showTextEditor = currentVar.value_type === 'secret' || currentVar.value_type === 'string' || currentVar.value_type === 'number'
  const isSysFiles = currentVar.type === VarInInspectType.system && currentVar.name === 'files'
  const showJSONEditor = !isSysFiles && (currentVar.value_type === 'object' || currentVar.value_type === 'array[string]' || currentVar.value_type === 'array[number]' || currentVar.value_type === 'array[object]' || currentVar.value_type === 'array[any]')
  const showFileEditor = isSysFiles || currentVar.value_type === 'file' || currentVar.value_type === 'array[file]'
  const textEditorDisabled = currentVar.type === VarInInspectType.environment || (currentVar.type === VarInInspectType.system && currentVar.name !== 'query' && currentVar.name !== 'files')
  const JSONEditorDisabled = currentVar.value_type === 'array[any]'

  const formatFileValue = (value: VarInInspect) => {
    if (value.value_type === 'file')
      return value.value ? getProcessedFilesFromResponse([value.value]) : []
    if (value.value_type === 'array[file]' || (value.type === VarInInspectType.system && currentVar.name === 'files'))
      return value.value && value.value.length > 0 ? getProcessedFilesFromResponse(value.value) : []
    return []
  }

  const [value, setValue] = useState<any>()
  const [json, setJson] = useState('')
  const [parseError, setParseError] = useState<Error | null>(null)
  const [validationError, setValidationError] = useState<string>('')
  const fileFeature = useFeatures(s => s.features.file)
  const [fileValue, setFileValue] = useState<any>(formatFileValue(currentVar))

  const { run: debounceValueChange } = useDebounceFn(handleValueChange, { wait: 500 })

  // update default value when id changed
  useEffect(() => {
    if (showTextEditor) {
      if (currentVar.value_type === 'number')
        return setValue(JSON.stringify(currentVar.value))
      if (!currentVar.value)
        return setValue('')
      setValue(currentVar.value)
    }
    if (showJSONEditor)
      setJson(currentVar.value ? JSON.stringify(currentVar.value, null, 2) : '')

    if (showFileEditor)
      setFileValue(formatFileValue(currentVar))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentVar.id, currentVar.value])

  const handleTextChange = (value: string) => {
    if (currentVar.value_type === 'string')
      setValue(value)

    if (currentVar.value_type === 'number') {
      if (/^-?\d+(\.)?(\d+)?$/.test(value))
        setValue(Number.parseFloat(value))
    }
    const newValue = currentVar.value_type === 'number' ? Number.parseFloat(value) : value
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
    setJson(value)
    if (jsonValueValidate(value, currentVar.value_type)) {
      const parsed = JSON.parse(value)
      debounceValueChange(currentVar.id, parsed)
    }
  }

  const fileValueValidate = (fileList: any[]) => fileList.every(file => file.upload_file_id)

  const handleFileChange = (value: any[]) => {
    setFileValue(value)
    // check every file upload progress
    // invoke update api after every file uploaded
    if (!fileValueValidate(value))
      return
    if (currentVar.value_type === 'file')
      debounceValueChange(currentVar.id, value[0])
    if (currentVar.value_type === 'array[file]' || isSysFiles)
      debounceValueChange(currentVar.id, value)
  }

  // get editor height
  useEffect(() => {
    if (contentContainerRef.current && errorMessageRef.current) {
      const errorMessageObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const { inlineSize } = entry.borderBoxSize[0]
          const height = (contentContainerRef.current as any).clientHeight - inlineSize
          setEditorHeight(height)
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
      className='flex h-full flex-col'
    >
      <div className={cn('grow')} style={{ height: `${editorHeight}px` }}>
        {showTextEditor && (
          <Textarea
            readOnly={textEditorDisabled}
            disabled={textEditorDisabled}
            className='h-full'
            value={value as any}
            onChange={e => handleTextChange(e.target.value)}
          />
        )}
        {showJSONEditor && (
          <SchemaEditor
            readonly={JSONEditorDisabled}
            className='overflow-y-auto'
            hideTopMenu
            schema={json}
            onUpdate={handleEditorChange}
          />
        )}
        {showFileEditor && (
          <div className='max-w-[460px]'>
            <FileUploaderInAttachmentWrapper
              value={fileValue}
              onChange={files => handleFileChange(getProcessedFiles(files))}
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
                number_limits: currentVar.value_type === 'file' ? 1 : (fileFeature as any).fileUploadConfig?.workflow_file_upload_limit || 5,
                fileUploadConfig: (fileFeature as any).fileUploadConfig,
              }}
              isDisabled={textEditorDisabled}
            />
          </div>
        )}
      </div>
      <div ref={errorMessageRef} className='shrink-0'>
        {parseError && <ErrorMessage className='mt-1' message={parseError.message} />}
        {validationError && <ErrorMessage className='mt-1' message={validationError} />}
      </div>
    </div>
  )
}

export default ValueContent
