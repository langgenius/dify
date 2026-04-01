import type { VarInInspect } from '@/types/workflow'
import { useDebounceFn } from 'ahooks'
import * as React from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { getProcessedFiles } from '@/app/components/base/file-uploader/utils'
import { useStore } from '@/app/components/workflow/store'
import { cn } from '@/utils/classnames'
import BoolValue from '../panel/chat-variable-panel/components/bool-value'
import {
  BoolArraySection,
  ErrorMessages,
  FileEditorSection,
  JsonEditorSection,
  TextEditorSection,
} from './value-content-sections'
import {
  formatInspectFileValue,
  getValueEditorState,
  isFileValueUploaded,
  validateInspectJsonValue,
} from './value-content.helpers'

type Props = {
  currentVar: VarInInspect
  handleValueChange: (varId: string, value: any) => void
  isTruncated: boolean
}

const ValueContent = ({
  currentVar,
  handleValueChange,
  isTruncated,
}: Props) => {
  const contentContainerRef = useRef<HTMLDivElement>(null)
  const errorMessageRef = useRef<HTMLDivElement>(null)
  const [editorHeight, setEditorHeight] = useState(0)
  const {
    showTextEditor,
    showBoolEditor,
    showBoolArrayEditor,
    isSysFiles,
    showJSONEditor,
    showFileEditor,
    textEditorDisabled,
    JSONEditorDisabled,
    hasChunks,
  } = useMemo(() => getValueEditorState(currentVar), [currentVar])
  const fileUploadConfig = useStore(s => s.fileUploadConfig)

  const [value, setValue] = useState<any>()
  const [json, setJson] = useState('')
  const [parseError, setParseError] = useState<Error | null>(null)
  const [validationError, setValidationError] = useState<string>('')
  const [fileValue, setFileValue] = useState<any>(() => formatInspectFileValue(currentVar))

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
      setJson(currentVar.value != null ? JSON.stringify(currentVar.value, null, 2) : '')

    if (showFileEditor)
      setFileValue(formatInspectFileValue(currentVar))
  }, [currentVar.id, currentVar.value])

  const handleTextChange = (value: string) => {
    if (isTruncated)
      return
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
    const result = validateInspectJsonValue(value, type)
    setParseError(result.parseError)
    setValidationError(result.validationError)
    return result.success
  }

  const handleEditorChange = (value: string) => {
    if (isTruncated)
      return
    setJson(value)
    if (jsonValueValidate(value, currentVar.value_type)) {
      const parsed = JSON.parse(value)
      debounceValueChange(currentVar.id, parsed)
    }
  }

  const handleFileChange = (value: any[]) => {
    setFileValue(value)
    // check every file upload progress
    // invoke update api after every file uploaded
    if (!isFileValueUploaded(value))
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
      className="flex h-full flex-col"
    >
      <div className={cn('relative grow')} style={{ height: `${editorHeight}px` }}>
        {showTextEditor && (
          <TextEditorSection
            currentVar={currentVar}
            value={value}
            textEditorDisabled={textEditorDisabled}
            isTruncated={isTruncated}
            onTextChange={handleTextChange}
          />
        )}
        {showBoolEditor && (
          <div className="w-[295px]">
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
            <BoolArraySection
              values={currentVar.value as boolean[]}
              onChange={(newArray) => {
                setValue(newArray)
                debounceValueChange(currentVar.id, newArray)
              }}
            />
          )
        }
        {showJSONEditor && (
          <JsonEditorSection
            hasChunks={hasChunks}
            schemaType={currentVar.schemaType}
            valueType={currentVar.value_type}
            json={json}
            readonly={JSONEditorDisabled}
            isTruncated={isTruncated}
            onChange={handleEditorChange}
          />
        )}
        {showFileEditor && (
          <FileEditorSection
            currentVar={currentVar}
            fileValue={fileValue}
            fileUploadConfig={fileUploadConfig}
            textEditorDisabled={textEditorDisabled}
            onChange={files => handleFileChange(getProcessedFiles(files))}
          />
        )}
      </div>
      <div ref={errorMessageRef} className="shrink-0">
        <ErrorMessages
          parseError={parseError}
          validationError={validationError}
        />
      </div>
    </div>
  )
}

export default React.memo(ValueContent)
