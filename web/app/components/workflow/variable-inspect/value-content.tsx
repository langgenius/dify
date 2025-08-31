import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useDebounceFn } from 'ahooks'
import { RiBracesLine, RiEyeLine } from '@remixicon/react'
import Textarea from '@/app/components/base/textarea'
import { Markdown } from '@/app/components/base/markdown'
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
import { getProcessedFiles, getProcessedFilesFromResponse } from '@/app/components/base/file-uploader/utils'
import { SegmentedControl } from '@/app/components/base/segmented-control'
import { JSON_SCHEMA_MAX_DEPTH } from '@/config'
import { TransferMethod } from '@/types/app'
import { FILE_EXTS } from '@/app/components/base/prompt-editor/constants'
import { SupportUploadFileTypes } from '@/app/components/workflow/types'
import type { VarInInspect } from '@/types/workflow'
import { VarInInspectType } from '@/types/workflow'
import cn from '@/utils/classnames'
import BoolValue from '../panel/chat-variable-panel/components/bool-value'
import { useStore } from '@/app/components/workflow/store'
import { ChunkCardList } from '@/app/components/rag-pipeline/components/chunk-card-list'
import type { ChunkInfo } from '@/app/components/rag-pipeline/components/chunk-card-list/types'
import { PreviewMode } from '../../base/features/types'
import { ChunkingMode } from '@/models/datasets'

enum ViewMode {
  Code = 'code',
  Preview = 'preview',
}

enum ContentType {
  Markdown = 'markdown',
  Chunks = 'chunks',
}

type DisplayContentProps = {
  type: ContentType
  mdString?: string
  jsonString?: string
  readonly: boolean
  handleTextChange?: (value: string) => void
  handleEditorChange?: (value: string) => void
}

const DisplayContent = (props: DisplayContentProps) => {
  const { type, mdString, jsonString, readonly, handleTextChange, handleEditorChange } = props
  const [viewMode, setViewMode] = useState<ViewMode>(ViewMode.Code)
  const [isFocused, setIsFocused] = useState(false)
  const { t } = useTranslation()

  return (
    <div className={cn('flex h-full flex-col rounded-[10px] bg-components-input-bg-normal', isFocused && 'bg-components-input-bg-active outline outline-1 outline-components-input-border-active')}>
      <div className='flex shrink-0 items-center justify-between p-1'>
        <div className='system-xs-semibold-uppercase flex items-center px-2 py-0.5 text-text-secondary'>
          {type.toUpperCase()}
        </div>
        <SegmentedControl
          options={[
            { value: ViewMode.Code, text: t('workflow.nodes.templateTransform.code'), Icon: RiBracesLine },
            { value: ViewMode.Preview, text: t('workflow.common.preview'), Icon: RiEyeLine },
          ]}
          value={viewMode}
          onChange={setViewMode}
          size='small'
          padding='with'
          activeClassName='!text-text-accent-light-mode-only'
          btnClassName='!pl-1.5 !pr-0.5 gap-[3px]'
        />
      </div>
      <div className='flex flex-1 overflow-auto rounded-b-[10px] pl-3 pr-1'>
        {viewMode === ViewMode.Code && (
          type === ContentType.Markdown
            ? <Textarea
              readOnly={readonly}
              disabled={readonly}
              className='h-full border-none bg-transparent p-0 text-text-secondary hover:bg-transparent focus:bg-transparent focus:shadow-none'
              value={mdString as any}
              onChange={e => handleTextChange?.(e.target.value)}
              onFocus={() => setIsFocused(true)}
              onBlur={() => setIsFocused(false)}
            />
            : <SchemaEditor
              readonly={readonly}
              className='overflow-y-auto bg-transparent'
              hideTopMenu
              schema={jsonString!}
              onUpdate={handleEditorChange!}
              onFocus={() => setIsFocused(true)}
              onBlur={() => setIsFocused(false)}
            />
        )}
        {viewMode === ViewMode.Preview && (
          type === ContentType.Markdown
            ? <Markdown className='grow overflow-auto rounded-lg !bg-white px-4 py-3' content={(mdString ?? '') as string} />
            : <ChunkCardList
              chunkType={ChunkingMode.text} // todo: delete mock data
              parentMode={'full-doc'} // todo: delete mock data
              chunkInfo={JSON.parse(jsonString!) as ChunkInfo}
            />
        )}
      </div>
    </div>
  )
}

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
  const showBoolEditor = typeof currentVar.value === 'boolean'
  const showBoolArrayEditor = Array.isArray(currentVar.value) && currentVar.value.every(v => typeof v === 'boolean')
  const isSysFiles = currentVar.type === VarInInspectType.system && currentVar.name === 'files'
  const showJSONEditor = !isSysFiles && (currentVar.value_type === 'object' || currentVar.value_type === 'array[string]' || currentVar.value_type === 'array[number]' || currentVar.value_type === 'array[object]' || currentVar.value_type === 'array[any]')
  const showFileEditor = isSysFiles || currentVar.value_type === 'file' || currentVar.value_type === 'array[file]'
  const textEditorDisabled = currentVar.type === VarInInspectType.environment || (currentVar.type === VarInInspectType.system && currentVar.name !== 'query' && currentVar.name !== 'files')
  const JSONEditorDisabled = currentVar.value_type === 'array[any]'
  const fileUploadConfig = useStore(s => s.fileUploadConfig)

  const hasChunks = useMemo(() => {
    return currentVar.value_type === 'object'
      && currentVar.value
      && typeof currentVar.value === 'object'
      && ['parent_child_chunks', 'general_chunks', 'qa_chunks'].some(key => key in currentVar.value)
  }, [currentVar.value_type, currentVar.value])

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
          currentVar.value_type === 'string' ? (
            <DisplayContent
              type={ContentType.Markdown}
              mdString={value as any}
              readonly={textEditorDisabled}
              handleTextChange={handleTextChange}
            />
          ) : <Textarea
            readOnly={textEditorDisabled}
            disabled={textEditorDisabled}
            className='h-full'
            value={value as any}
            onChange={e => handleTextChange(e.target.value)}
          />
        )}
        {showBoolEditor && (
          <div className='w-[295px]'>
            <BoolValue
              value={currentVar.value as boolean}
              onChange={(newValue) => {
                setValue(newValue)
                debounceValueChange(currentVar.id, newValue)
              }}
            />
          </div>
        )}
        {
          showBoolArrayEditor && (
            <div className='w-[295px] space-y-1'>
              {currentVar.value.map((v: boolean, i: number) => (
                <BoolValue
                  key={i}
                  value={v}
                  onChange={(newValue) => {
                    const newArray = [...(currentVar.value as boolean[])]
                    newArray[i] = newValue
                    setValue(newArray)
                    debounceValueChange(currentVar.id, newArray)
                  }}
                />
              ))}
            </div>
          )
        }
        {showJSONEditor && (
          hasChunks
            ? <DisplayContent
              type={ContentType.Chunks}
              jsonString={json ?? '{}'}
              readonly={JSONEditorDisabled}
              handleEditorChange={handleEditorChange}
            />
            : <SchemaEditor
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
                number_limits: currentVar.value_type === 'file' ? 1 : fileUploadConfig?.workflow_file_upload_limit || 5,
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
      <div ref={errorMessageRef} className='shrink-0'>
        {parseError && <ErrorMessage className='mt-1' message={parseError.message} />}
        {validationError && <ErrorMessage className='mt-1' message={validationError} />}
      </div>
    </div>
  )
}

export default ValueContent
