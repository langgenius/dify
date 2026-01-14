'use client'
import type { FC } from 'react'
import type { UploadFileSetting } from '../../../types'
import { produce } from 'immer'
import * as React from 'react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import Field from '@/app/components/app/configuration/config-var/config-modal/field'
import { useFileSizeLimit } from '@/app/components/base/file-uploader/hooks'
import { useFileUploadConfig } from '@/service/use-common'
import { TransferMethod } from '@/types/app'
import { formatFileSize } from '@/utils/format'
import { SupportUploadFileTypes } from '../../../types'
import FileTypeItem from './file-type-item'
import InputNumberWithSlider from './input-number-with-slider'
import OptionCard from './option-card'

type Props = {
  payload: UploadFileSetting
  isMultiple: boolean
  inFeaturePanel?: boolean
  hideSupportFileType?: boolean
  onChange: (payload: UploadFileSetting) => void
}

const FileUploadSetting: FC<Props> = ({
  payload,
  isMultiple,
  inFeaturePanel = false,
  hideSupportFileType = false,
  onChange,
}) => {
  const { t } = useTranslation()

  const {
    allowed_file_upload_methods,
    max_length,
    allowed_file_types,
    allowed_file_extensions,
  } = payload
  const { data: fileUploadConfigResponse } = useFileUploadConfig()
  const {
    imgSizeLimit,
    docSizeLimit,
    audioSizeLimit,
    videoSizeLimit,
    maxFileUploadLimit,
  } = useFileSizeLimit(fileUploadConfigResponse)

  const handleSupportFileTypeChange = useCallback((type: SupportUploadFileTypes) => {
    const newPayload = produce(payload, (draft) => {
      if (type === SupportUploadFileTypes.custom) {
        if (!draft.allowed_file_types.includes(SupportUploadFileTypes.custom))
          draft.allowed_file_types = [SupportUploadFileTypes.custom]

        else
          draft.allowed_file_types = draft.allowed_file_types.filter(v => v !== type)
      }
      else {
        draft.allowed_file_types = draft.allowed_file_types.filter(v => v !== SupportUploadFileTypes.custom)
        if (draft.allowed_file_types.includes(type))
          draft.allowed_file_types = draft.allowed_file_types.filter(v => v !== type)
        else
          draft.allowed_file_types.push(type)
      }
    })
    onChange(newPayload)
  }, [onChange, payload])

  const handleUploadMethodChange = useCallback((method: TransferMethod) => {
    return () => {
      const newPayload = produce(payload, (draft) => {
        if (method === TransferMethod.all)
          draft.allowed_file_upload_methods = [TransferMethod.local_file, TransferMethod.remote_url]
        else
          draft.allowed_file_upload_methods = [method]
      })
      onChange(newPayload)
    }
  }, [onChange, payload])

  const handleCustomFileTypesChange = useCallback((customFileTypes: string[]) => {
    const newPayload = produce(payload, (draft) => {
      draft.allowed_file_extensions = customFileTypes.map((v) => {
        return v
      })
    })
    onChange(newPayload)
  }, [onChange, payload])

  const handleMaxUploadNumLimitChange = useCallback((value: number) => {
    const newPayload = produce(payload, (draft) => {
      draft.max_length = value
    })
    onChange(newPayload)
  }, [onChange, payload])

  return (
    <div>
      {!inFeaturePanel && (
        <Field
          title={t('variableConfig.file.supportFileTypes', { ns: 'appDebug' })}
        >
          <div className="space-y-1">
            {
              [SupportUploadFileTypes.document, SupportUploadFileTypes.image, SupportUploadFileTypes.audio, SupportUploadFileTypes.video].map((type: SupportUploadFileTypes) => (
                <FileTypeItem
                  key={type}
                  type={type as SupportUploadFileTypes.image | SupportUploadFileTypes.document | SupportUploadFileTypes.audio | SupportUploadFileTypes.video}
                  selected={allowed_file_types.includes(type)}
                  onToggle={handleSupportFileTypeChange}
                />
              ))
            }
            <FileTypeItem
              type={SupportUploadFileTypes.custom}
              selected={allowed_file_types.includes(SupportUploadFileTypes.custom)}
              onToggle={handleSupportFileTypeChange}
              customFileTypes={allowed_file_extensions}
              onCustomFileTypesChange={handleCustomFileTypesChange}
            />
          </div>
        </Field>
      )}
      <Field
        title={t('variableConfig.uploadFileTypes', { ns: 'appDebug' })}
        className="mt-4"
      >
        <div className="grid grid-cols-3 gap-2">
          <OptionCard
            title={t('variableConfig.localUpload', { ns: 'appDebug' })}
            selected={allowed_file_upload_methods.length === 1 && allowed_file_upload_methods.includes(TransferMethod.local_file)}
            onSelect={handleUploadMethodChange(TransferMethod.local_file)}
          />
          <OptionCard
            title="URL"
            selected={allowed_file_upload_methods.length === 1 && allowed_file_upload_methods.includes(TransferMethod.remote_url)}
            onSelect={handleUploadMethodChange(TransferMethod.remote_url)}
          />
          <OptionCard
            title={t('variableConfig.both', { ns: 'appDebug' })}
            selected={allowed_file_upload_methods.includes(TransferMethod.local_file) && allowed_file_upload_methods.includes(TransferMethod.remote_url)}
            onSelect={handleUploadMethodChange(TransferMethod.all)}
          />
        </div>
      </Field>
      {isMultiple && (
        <Field
          className="mt-4"
          title={t('variableConfig.maxNumberOfUploads', { ns: 'appDebug' })!}
        >
          <div>
            <div className="body-xs-regular mb-1.5 text-text-tertiary">
              {t('variableConfig.maxNumberTip', {
                ns: 'appDebug',
                imgLimit: formatFileSize(imgSizeLimit),
                docLimit: formatFileSize(docSizeLimit),
                audioLimit: formatFileSize(audioSizeLimit),
                videoLimit: formatFileSize(videoSizeLimit),
              })}
            </div>

            <InputNumberWithSlider
              value={max_length}
              min={1}
              max={maxFileUploadLimit}
              onChange={handleMaxUploadNumLimitChange}
            />
          </div>
        </Field>
      )}
      {inFeaturePanel && !hideSupportFileType && (
        <Field
          title={t('variableConfig.file.supportFileTypes', { ns: 'appDebug' })}
          className="mt-4"
        >
          <div className="space-y-1">
            {
              [SupportUploadFileTypes.document, SupportUploadFileTypes.image, SupportUploadFileTypes.audio, SupportUploadFileTypes.video].map((type: SupportUploadFileTypes) => (
                <FileTypeItem
                  key={type}
                  type={type as SupportUploadFileTypes.image | SupportUploadFileTypes.document | SupportUploadFileTypes.audio | SupportUploadFileTypes.video}
                  selected={allowed_file_types.includes(type)}
                  onToggle={handleSupportFileTypeChange}
                />
              ))
            }
            <FileTypeItem
              type={SupportUploadFileTypes.custom}
              selected={allowed_file_types.includes(SupportUploadFileTypes.custom)}
              onToggle={handleSupportFileTypeChange}
              customFileTypes={allowed_file_extensions}
              onCustomFileTypesChange={handleCustomFileTypesChange}
            />
          </div>
        </Field>
      )}

    </div>
  )
}
export default React.memo(FileUploadSetting)
