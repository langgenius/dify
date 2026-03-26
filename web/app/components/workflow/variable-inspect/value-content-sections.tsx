import type { FileEntity } from '@/app/components/base/file-uploader/types'
import type { FileUploadConfigResponse } from '@/models/common'
import type { VarInInspect } from '@/types/workflow'
import { FileUploaderInAttachmentWrapper } from '@/app/components/base/file-uploader'
import { FILE_EXTS } from '@/app/components/base/prompt-editor/constants'
import Textarea from '@/app/components/base/textarea'
import ErrorMessage from '@/app/components/workflow/nodes/llm/components/json-schema-config-modal/error-message'
import SchemaEditor from '@/app/components/workflow/nodes/llm/components/json-schema-config-modal/schema-editor'
import { SupportUploadFileTypes } from '@/app/components/workflow/types'
import { TransferMethod } from '@/types/app'
import { cn } from '@/utils/classnames'
import { PreviewMode } from '../../base/features/types'
import BoolValue from '../panel/chat-variable-panel/components/bool-value'
import DisplayContent from './display-content'
import LargeDataAlert from './large-data-alert'
import { PreviewType } from './types'

type TextEditorSectionProps = {
  currentVar: VarInInspect
  value: unknown
  textEditorDisabled: boolean
  isTruncated: boolean
  onTextChange: (value: string) => void
}

export const TextEditorSection = ({
  currentVar,
  value,
  textEditorDisabled,
  isTruncated,
  onTextChange,
}: TextEditorSectionProps) => {
  return (
    <>
      {isTruncated && <LargeDataAlert className="absolute left-3 right-3 top-1" />}
      {currentVar.value_type === 'string'
        ? (
            <DisplayContent
              previewType={PreviewType.Markdown}
              varType={currentVar.value_type}
              mdString={typeof value === 'string' ? value : String(value ?? '')}
              readonly={textEditorDisabled}
              handleTextChange={onTextChange}
              className={cn(isTruncated && 'pt-[36px]')}
            />
          )
        : (
            <Textarea
              readOnly={textEditorDisabled}
              disabled={textEditorDisabled || isTruncated}
              className={cn('h-full', isTruncated && 'pt-[48px]')}
              value={typeof value === 'number' ? value : String(value ?? '')}
              onChange={e => onTextChange(e.target.value)}
            />
          )}
    </>
  )
}

type BoolArraySectionProps = {
  values: boolean[]
  onChange: (nextValue: boolean[]) => void
}

export const BoolArraySection = ({
  values,
  onChange,
}: BoolArraySectionProps) => {
  return (
    <div className="w-[295px] space-y-1">
      {values.map((value, index) => (
        <BoolValue
          key={`${index}-${String(value)}`}
          value={value}
          onChange={(newValue) => {
            const nextValue = [...values]
            nextValue[index] = newValue
            onChange(nextValue)
          }}
        />
      ))}
    </div>
  )
}

type JsonEditorSectionProps = {
  hasChunks: boolean
  schemaType?: string
  valueType: VarInInspect['value_type']
  json: string
  readonly: boolean
  isTruncated: boolean
  onChange: (value: string) => void
}

export const JsonEditorSection = ({
  hasChunks,
  schemaType,
  valueType,
  json,
  readonly,
  isTruncated,
  onChange,
}: JsonEditorSectionProps) => {
  if (hasChunks) {
    return (
      <DisplayContent
        previewType={PreviewType.Chunks}
        varType={valueType}
        schemaType={schemaType ?? ''}
        jsonString={json ?? '{}'}
        readonly={readonly}
        handleEditorChange={onChange}
      />
    )
  }

  return (
    <SchemaEditor
      readonly={readonly || isTruncated}
      className="overflow-y-auto"
      hideTopMenu
      schema={json}
      onUpdate={onChange}
      isTruncated={isTruncated}
    />
  )
}

type FileEditorSectionProps = {
  currentVar: VarInInspect
  fileValue: FileEntity[]
  fileUploadConfig?: FileUploadConfigResponse
  textEditorDisabled: boolean
  onChange: (files: FileEntity[]) => void
}

export const FileEditorSection = ({
  currentVar,
  fileValue,
  fileUploadConfig,
  textEditorDisabled,
  onChange,
}: FileEditorSectionProps) => {
  return (
    <div className="max-w-[460px]">
      <FileUploaderInAttachmentWrapper
        value={fileValue}
        onChange={onChange}
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
  )
}

export const ErrorMessages = ({
  parseError,
  validationError,
}: {
  parseError: Error | null
  validationError: string
}) => {
  return (
    <>
      {parseError && <ErrorMessage className="mt-1" message={parseError.message} />}
      {validationError && <ErrorMessage className="mt-1" message={validationError} />}
    </>
  )
}
