'use client'
import type { FC } from 'react'
import React, { useCallback } from 'react'
import produce from 'immer'
import type { UploadFileSetting } from '../../../types'
import { SupportUploadFileTypes } from '../../../types'
import OptionCard from './option-card'
import FileTypeItem from './file-type-item'
import Field from '@/app/components/app/configuration/config-var/config-modal/field'
import { TransferMethod } from '@/types/app'

type Props = {
  payload: UploadFileSetting
  isMultiple: boolean
  onChange: (payload: UploadFileSetting) => void
}

const FileUploadSetting: FC<Props> = ({
  payload,
  isMultiple,
  onChange,
}) => {
  const {
    uploadMethod,
    maxUploadNumLimit,
    supportFileTypes,
    customFileTypes,
  } = payload

  const handleSupportFileTypeChange = useCallback((type: SupportUploadFileTypes) => {
    const newPayload = produce(payload, (draft) => {
      draft.supportFileTypes = type
    })
    onChange(newPayload)
  }, [onChange, payload])

  const handleUploadMethodChange = useCallback((method: TransferMethod) => {
    return () => {
      const newPayload = produce(payload, (draft) => {
        draft.uploadMethod = method
      })
      onChange(newPayload)
    }
  }, [onChange, payload])

  const handleCustomFileTypesChange = useCallback((customFileTypes: string[]) => {
    const newPayload = produce(payload, (draft) => {
      draft.customFileTypes = customFileTypes.map((v) => {
        if (v.startsWith('.'))
          return v
        return `.${v}`
      })
    })
    onChange(newPayload)
  }, [onChange, payload])

  return (
    <div>
      <Field
        title='SupportFile Types'
      >
        <div className='space-y-1'>
          {
            [SupportUploadFileTypes.image, SupportUploadFileTypes.document, SupportUploadFileTypes.audio, SupportUploadFileTypes.video].map((type: SupportUploadFileTypes) => (
              <FileTypeItem
                key={type}
                type={type as SupportUploadFileTypes.image | SupportUploadFileTypes.document | SupportUploadFileTypes.audio | SupportUploadFileTypes.video}
                selected={supportFileTypes === type}
                onSelect={handleSupportFileTypeChange}
              />
            ))
          }
          <FileTypeItem
            type={SupportUploadFileTypes.custom}
            selected={supportFileTypes === SupportUploadFileTypes.custom}
            onSelect={handleSupportFileTypeChange}
            customFileTypes={customFileTypes}
            onCustomFileTypesChange={handleCustomFileTypesChange}
          />
        </div>
      </Field>
      <Field
        title='Upload File Types'
        className='mt-4'
      >
        <div className='grid grid-cols-3 gap-2'>
          <OptionCard
            title='Local Upload'
            selected={uploadMethod === TransferMethod.local_file}
            onSelect={handleUploadMethodChange(TransferMethod.local_file)}
          />
          <OptionCard
            title="URL"
            selected={uploadMethod === TransferMethod.remote_url}
            onSelect={handleUploadMethodChange(TransferMethod.remote_url)}
          />
          <OptionCard
            title="Both"
            selected={uploadMethod === TransferMethod.all}
            onSelect={handleUploadMethodChange(TransferMethod.all)}
          />
        </div>
      </Field>
      {isMultiple && (
        <Field
          title='Max number of uploads'
        >
          <div>
            <span>Max number of uploads</span>
          </div>
        </Field>
      )}

    </div>
  )
}
export default React.memo(FileUploadSetting)
