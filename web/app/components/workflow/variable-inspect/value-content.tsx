import { useEffect, useRef, useState } from 'react'
// import { useTranslation } from 'react-i18next'
import { debounce } from 'lodash-es'
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
import { getProcessedFiles } from '@/app/components/base/file-uploader/utils'
import { JSON_SCHEMA_MAX_DEPTH } from '@/config'
import { TransferMethod } from '@/types/app'
import { FILE_EXTS } from '@/app/components/base/prompt-editor/constants'
import { SupportUploadFileTypes } from '@/app/components/workflow/types'
import type { VarInInspect } from '@/types/workflow'
import { VarInInspectType } from '@/types/workflow'
import cn from '@/utils/classnames'

export const MOCK_DATA = {
  id: 'var-jfkldjjfkldaf-dfhekdfj',
  type: 'node',
  // type: 'conversation',
  // type: 'environment',
  name: 'out_put',
  // value_type: 'string',
  // value_type: 'number',
  // value_type: 'object',
  // value_type: 'array[string]',
  // value_type: 'array[number]',
  // value_type: 'array[object]',
  // value_type: 'file',
  value_type: 'array[file]',
  // value: 'tuituitui',
  // value: ['aaa', 'bbb', 'ccc'],
  // value: {
  //   abc: '123',
  //   def: 456,
  //   fff: true,
  // },
  value: [],
  edited: true,
}

type Props = {
  currentVar: VarInInspect
}

const ValueContent = ({
  // currentVar = MOCK_DATA as any, // TODO remove this line
  currentVar,
}: Props) => {
  const contentContainerRef = useRef<HTMLDivElement>(null)
  const errorMessageRef = useRef<HTMLDivElement>(null)
  const [editorHeight, setEditorHeight] = useState(0)
  const showTextEditor = currentVar.value_type === 'secret' || currentVar.value_type === 'string' || currentVar.value_type === 'number'
  const showJSONEditor = currentVar.value_type === 'object' || currentVar.value_type === 'array[string]' || currentVar.value_type === 'array[number]' || currentVar.value_type === 'array[object]'
  const showFileEditor = currentVar.value_type === 'file' || currentVar.value_type === 'array[file]'

  const [value, setValue] = useState<any>()
  const [jsonSchema, setJsonSchema] = useState()
  const [json, setJson] = useState('')
  const [parseError, setParseError] = useState<Error | null>(null)
  const [validationError, setValidationError] = useState<string>('')
  const fileFeature = useFeatures(s => s.features.file)
  const [fileValue, setFileValue] = useState<any>(
    currentVar.value_type === 'array[file]'
    ? currentVar.value || []
    : currentVar.value
      ? [currentVar.value]
      : [],
  )

  // update default value when id changed
  useEffect(() => {
    if (showTextEditor) {
      if (!currentVar.value)
        return setValue('')
      if (currentVar.value_type === 'number')
        return setValue(JSON.stringify(currentVar.value))
      setValue(currentVar.value)
    }
    if (showJSONEditor) {
      setJsonSchema(currentVar.value || null)
      setJson(currentVar.value ? JSON.stringify(currentVar.value, null, 2) : '')
    }
    if (showFileEditor) {
      setFileValue(currentVar.value_type === 'array[file]'
        ? currentVar.value || []
        : currentVar.value
          ? [currentVar.value]
          : [])
    }
  }, [currentVar, showTextEditor, showJSONEditor, showFileEditor])

  const handleTextChange = (value: string) => {
    if (currentVar.value_type === 'string')
      setValue(value)

    if (currentVar.value_type === 'number') {
      if (/^-?\d+(\.)?(\d+)?$/.test(value))
        setValue(value)
    }
    // TODO call api of value update
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
      setJsonSchema(parsed)
      // TODO call api of value update
    }
  }

  const handleFileChange = (value: any) => {
    console.log('value', value)
    setFileValue(value)
    // TODO check every file upload progress
    // invoke update api after every file uploaded
    if (currentVar.value_type === 'file') {
      // TODO call api of value update
    }
    if (currentVar.value_type === 'array[file]') {
      // TODO call api of value update
    }
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
  }, [errorMessageRef.current, setEditorHeight])

  return (
    <div
      ref={contentContainerRef}
      className='flex h-full flex-col'
    >
      <div className={cn('grow')} style={{ height: `${editorHeight}px` }}>
        {showTextEditor && (
          <Textarea
            readOnly={currentVar.type === VarInInspectType.environment}
            disabled={currentVar.type === VarInInspectType.environment}
            className='h-full'
            value={value as any}
            onChange={e => handleTextChange(e.target.value)}
          />
        )}
        {showJSONEditor && (
          <SchemaEditor
            className='overflow-y-auto'
            hideTopMenu
            schema={json}
            onUpdate={debounce(handleEditorChange)}
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
