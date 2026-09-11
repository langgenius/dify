'use client'
import type { FC } from 'react'
import type { UploadFileSetting } from '../../../types'
import { cn } from '@langgenius/dify-ui/cn'
import { FieldItem, FieldLabel, Field as FormField } from '@langgenius/dify-ui/field'
import { Fieldset, FieldsetLegend } from '@langgenius/dify-ui/fieldset'
import { RadioGroup, RadioItem } from '@langgenius/dify-ui/radio-group'
import { produce } from 'immer'
import * as React from 'react'
import { useCallback, useId } from 'react'
import { useTranslation } from 'react-i18next'
import Field from '@/app/components/app/configuration/config-var/config-modal/field'
import { useFileSizeLimit } from '@/app/components/base/file-uploader/hooks'
import { useFileUploadConfig } from '@/service/use-common'
import { TransferMethod } from '@/types/app'
import { formatFileSize } from '@/utils/format'
import { SupportUploadFileTypes } from '../../../types'
import FileTypeItem from './file-type-item'
import InputNumberWithSlider from './input-number-with-slider'

type Props = Readonly<{
  payload: UploadFileSetting
  isMultiple: boolean
  inFeaturePanel?: boolean
  hideSupportFileType?: boolean
  validationError?: {
    field: 'allowed_file_types' | 'allowed_file_extensions'
    message: string
  }
  onChange: (payload: UploadFileSetting) => void
}>

const FileUploadSetting: FC<Props> = ({
  payload,
  isMultiple,
  inFeaturePanel = false,
  hideSupportFileType = false,
  validationError,
  onChange,
}) => {
  const { t } = useTranslation()
  const errorId = useId()
  const typeErrorId = validationError?.field === 'allowed_file_types' ? errorId : undefined
  const customFileTypesErrorId =
    validationError?.field === 'allowed_file_extensions' ? errorId : undefined

  const {
    allowed_file_upload_methods = [],
    max_length,
    allowed_file_types = [],
    allowed_file_extensions = [],
  } = payload
  const { data: fileUploadConfigResponse } = useFileUploadConfig()
  const { imgSizeLimit, docSizeLimit, audioSizeLimit, videoSizeLimit, maxFileUploadLimit } =
    useFileSizeLimit(fileUploadConfigResponse)

  const handleSupportFileTypeChange = useCallback(
    (type: SupportUploadFileTypes) => {
      const newPayload = produce(payload, (draft) => {
        if (type === SupportUploadFileTypes.custom) {
          if (!draft.allowed_file_types.includes(SupportUploadFileTypes.custom))
            draft.allowed_file_types = [SupportUploadFileTypes.custom]
          else draft.allowed_file_types = draft.allowed_file_types.filter((v) => v !== type)
        } else {
          draft.allowed_file_types = draft.allowed_file_types.filter(
            (v) => v !== SupportUploadFileTypes.custom,
          )
          if (draft.allowed_file_types.includes(type))
            draft.allowed_file_types = draft.allowed_file_types.filter((v) => v !== type)
          else draft.allowed_file_types.push(type)
        }
      })
      onChange(newPayload)
    },
    [onChange, payload],
  )

  const handleUploadMethodChange = useCallback(
    (method: TransferMethod | null) => {
      if (method === null) return
      const newPayload = produce(payload, (draft) => {
        draft.allowed_file_upload_methods =
          method === TransferMethod.all
            ? [TransferMethod.local_file, TransferMethod.remote_url]
            : [method]
      })
      onChange(newPayload)
    },
    [onChange, payload],
  )

  const selectedMethod = allowed_file_upload_methods.includes(TransferMethod.local_file)
    ? allowed_file_upload_methods.includes(TransferMethod.remote_url)
      ? TransferMethod.all
      : TransferMethod.local_file
    : allowed_file_upload_methods.includes(TransferMethod.remote_url)
      ? TransferMethod.remote_url
      : null
  const uploadMethods = [
    {
      value: TransferMethod.local_file,
      label: t(($) => $['variableConfig.localUpload'], { ns: 'appDebug' }),
    },
    { value: TransferMethod.remote_url, label: 'URL' },
    { value: TransferMethod.all, label: t(($) => $['variableConfig.both'], { ns: 'appDebug' }) },
  ]

  const handleCustomFileTypesChange = useCallback(
    (customFileTypes: string[]) => {
      const newPayload = produce(payload, (draft) => {
        draft.allowed_file_extensions = customFileTypes.map((v) => {
          return v
        })
      })
      onChange(newPayload)
    },
    [onChange, payload],
  )

  const handleMaxUploadNumLimitChange = useCallback(
    (value: number) => {
      const normalizedValue = Number.isFinite(value)
        ? Math.min(Math.max(value, 1), maxFileUploadLimit)
        : value
      const newPayload = produce(payload, (draft) => {
        draft.max_length = normalizedValue
      })
      onChange(newPayload)
    },
    [maxFileUploadLimit, onChange, payload],
  )

  return (
    <div>
      {!inFeaturePanel && (
        <Field
          title={t(($) => $['variableConfig.file.supportFileTypes'], { ns: 'appDebug' })}
          errorMessage={validationError?.message}
          errorId={errorId}
        >
          <div className="space-y-1">
            {[
              SupportUploadFileTypes.document,
              SupportUploadFileTypes.image,
              SupportUploadFileTypes.audio,
              SupportUploadFileTypes.video,
            ].map((type: SupportUploadFileTypes) => (
              <FileTypeItem
                key={type}
                type={
                  type as
                    | SupportUploadFileTypes.image
                    | SupportUploadFileTypes.document
                    | SupportUploadFileTypes.audio
                    | SupportUploadFileTypes.video
                }
                selected={allowed_file_types.includes(type)}
                onToggle={handleSupportFileTypeChange}
                typeErrorId={typeErrorId}
              />
            ))}
            <FileTypeItem
              type={SupportUploadFileTypes.custom}
              selected={allowed_file_types.includes(SupportUploadFileTypes.custom)}
              onToggle={handleSupportFileTypeChange}
              customFileTypes={allowed_file_extensions}
              onCustomFileTypesChange={handleCustomFileTypesChange}
              typeErrorId={typeErrorId}
              customFileTypesErrorId={customFileTypesErrorId}
            />
          </div>
        </Field>
      )}
      <FormField className="mt-4">
        <Fieldset
          className="flex flex-col items-stretch gap-0"
          render={
            <RadioGroup<TransferMethod | null>
              value={selectedMethod}
              onValueChange={handleUploadMethodChange}
            />
          }
        >
          <FieldsetLegend className="mb-0 py-0 system-sm-semibold leading-8!">
            {t(($) => $['variableConfig.uploadFileTypes'], { ns: 'appDebug' })}
          </FieldsetLegend>
          <div className="grid grid-cols-3 gap-2">
            {uploadMethods.map((method) => (
              <FieldItem key={method.value}>
                <FieldLabel className="block w-full min-w-0 py-0">
                  <RadioItem<TransferMethod>
                    value={method.value}
                    className={cn(
                      'flex h-8 w-full cursor-default items-center justify-center rounded-md border border-components-option-card-option-border bg-components-option-card-option-bg px-2 system-sm-regular text-text-secondary focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden data-checked:border-[1.5px] data-checked:border-components-option-card-option-selected-border data-checked:bg-components-option-card-option-selected-bg data-checked:shadow-xs',
                      selectedMethod !== method.value &&
                        'cursor-pointer hover:border-components-option-card-option-border-hover hover:bg-components-option-card-option-bg-hover hover:shadow-xs',
                    )}
                  >
                    <span>{method.label}</span>
                  </RadioItem>
                </FieldLabel>
              </FieldItem>
            ))}
          </div>
        </Fieldset>
      </FormField>
      {isMultiple && (
        <Field
          className="mt-4"
          title={t(($) => $['variableConfig.maxNumberOfUploads'], { ns: 'appDebug' })!}
        >
          <div>
            <div className="mb-1.5 body-xs-regular text-text-tertiary">
              {t(($) => $['variableConfig.maxNumberTip'], {
                ns: 'appDebug',
                imgLimit: formatFileSize(imgSizeLimit),
                docLimit: formatFileSize(docSizeLimit),
                audioLimit: formatFileSize(audioSizeLimit),
                videoLimit: formatFileSize(videoSizeLimit),
              })}
            </div>

            <InputNumberWithSlider
              label={t(($) => $['variableConfig.maxNumberOfUploads'], { ns: 'appDebug' })!}
              value={max_length}
              defaultValue={1}
              min={1}
              max={maxFileUploadLimit}
              onChange={handleMaxUploadNumLimitChange}
            />
          </div>
        </Field>
      )}
      {inFeaturePanel && !hideSupportFileType && (
        <Field
          title={t(($) => $['variableConfig.file.supportFileTypes'], { ns: 'appDebug' })}
          className="mt-4"
          errorMessage={validationError?.message}
          errorId={errorId}
        >
          <div className="space-y-1">
            {[
              SupportUploadFileTypes.document,
              SupportUploadFileTypes.image,
              SupportUploadFileTypes.audio,
              SupportUploadFileTypes.video,
            ].map((type: SupportUploadFileTypes) => (
              <FileTypeItem
                key={type}
                type={
                  type as
                    | SupportUploadFileTypes.image
                    | SupportUploadFileTypes.document
                    | SupportUploadFileTypes.audio
                    | SupportUploadFileTypes.video
                }
                selected={allowed_file_types.includes(type)}
                onToggle={handleSupportFileTypeChange}
                typeErrorId={typeErrorId}
              />
            ))}
            <FileTypeItem
              type={SupportUploadFileTypes.custom}
              selected={allowed_file_types.includes(SupportUploadFileTypes.custom)}
              onToggle={handleSupportFileTypeChange}
              customFileTypes={allowed_file_extensions}
              onCustomFileTypesChange={handleCustomFileTypesChange}
              typeErrorId={typeErrorId}
              customFileTypesErrorId={customFileTypesErrorId}
            />
          </div>
        </Field>
      )}
    </div>
  )
}
export default React.memo(FileUploadSetting)
