import { useEffect, useRef, useState } from 'react'
// import { useTranslation } from 'react-i18next'
import { debounce } from 'lodash-es'
import Textarea from '@/app/components/base/textarea'
import SchemaEditor from '@/app/components/workflow/nodes/llm/components/json-schema-config-modal/schema-editor'
import ErrorMessage from '@/app/components/workflow/nodes/llm/components/json-schema-config-modal/error-message'
import {
  checkJsonSchemaDepth,
  getValidationErrorMessage,
  validateSchemaAgainstDraft7,
} from '@/app/components/workflow/nodes/llm/utils'
import {
  validateJSONSchema,
} from '@/app/components/workflow/variable-inspect/utils'
import { JSON_SCHEMA_MAX_DEPTH } from '@/config'
import cn from '@/utils/classnames'

export const currentVar = {
  id: 'var-jfkldjjfkldaf-dfhekdfj',
  type: 'node',
  // type: 'conversation',
  // type: 'environment',
  name: 'out_put',
  // var_type: 'string',
  // var_type: 'number',
  var_type: 'object',
  // var_type: 'array[string]',
  // var_type: 'array[number]',
  // var_type: 'array[object]',
  // var_type: 'file',
  // var_type: 'array[file]',
  // value: 'tuituitui',
  // value: ['aaa', 'bbb', 'ccc'],
  value: {
    abc: '123',
    def: 456,
    fff: true,
  },
  edited: true,
}

const ValueContent = () => {
  const current = currentVar
  const contentContainerRef = useRef<HTMLDivElement>(null)
  const errorMessageRef = useRef<HTMLDivElement>(null)
  const [editorHeight, setEditorHeight] = useState(0)
  const showTextEditor = current.var_type === 'secret' || current.var_type === 'string' || current.var_type === 'number'
  const showJSONEditor = current.var_type === 'object' || current.var_type === 'array[string]' || current.var_type === 'array[number]' || current.var_type === 'array[object]'
  const showFileEditor = current.var_type === 'file' || current.var_type === 'array[file]'

  const [value, setValue] = useState<any>(current.value ? JSON.stringify(current.value) : '')
  const [jsonSchema, setJsonSchema] = useState(current.value || null)
  const [json, setJson] = useState(JSON.stringify(jsonSchema, null, 2))
  const [parseError, setParseError] = useState<Error | null>(null)
  const [validationError, setValidationError] = useState<string>('')

  const handleTextChange = (value: string) => {
    if (current.var_type === 'string')
      setValue(value)

    if (current.var_type === 'number') {
      if (/^-?\d+(\.)?(\d+)?$/.test(value))
        setValue(value)
    }
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
    if (jsonValueValidate(value, current.var_type)) {
      const parsed = JSON.parse(value)
      setJsonSchema(parsed)
      // TODO call api of value update
    }
  }

  const handleFileChange = (value: string) => {
    if (current.var_type === 'file') {
      // TODO update file
    }
    if (current.var_type === 'array[file]') {
      // TODO update array[file]
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
            readOnly={current.type === 'environment'}
            disabled={current.type === 'environment'}
            className='h-full'
            value={value as any}
            onChange={debounce(e => handleTextChange(e.target.value))}
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
          <div>TODO</div>
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
