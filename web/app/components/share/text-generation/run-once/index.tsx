import type { FC, FormEvent } from 'react'
import React from 'react'
import { useTranslation } from 'react-i18next'
import {
  PlayIcon,
} from '@heroicons/react/24/solid'
import Select from '@/app/components/base/select'
import type { SiteInfo } from '@/models/share'
import type { PromptConfig } from '@/models/debug'
import Button from '@/app/components/base/button'
import Textarea from '@/app/components/base/textarea'
import { DEFAULT_VALUE_MAX_LEN } from '@/config'
import TextGenerationImageUploader from '@/app/components/base/image-uploader/text-generation-image-uploader'
import type { VisionFile, VisionSettings } from '@/types/app'
import { FileUploaderInAttachmentWrapper } from '@/app/components/base/file-uploader'
import { getProcessedFiles } from '@/app/components/base/file-uploader/utils'

export type IRunOnceProps = {
  siteInfo: SiteInfo
  promptConfig: PromptConfig
  inputs: Record<string, any>
  onInputsChange: (inputs: Record<string, any>) => void
  onSend: () => void
  visionConfig: VisionSettings
  onVisionFilesChange: (files: VisionFile[]) => void
}
const RunOnce: FC<IRunOnceProps> = ({
  promptConfig,
  inputs,
  onInputsChange,
  onSend,
  visionConfig,
  onVisionFilesChange,
}) => {
  const { t } = useTranslation()

  const onClear = () => {
    const newInputs: Record<string, any> = {}
    promptConfig.prompt_variables.forEach((item) => {
      newInputs[item.key] = ''
    })
    onInputsChange(newInputs)
  }

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    onSend()
  }

  return (
    <div className="">
      <section>
        {/* input form */}
        <form onSubmit={onSubmit}>
          {promptConfig.prompt_variables.map(item => (
            <div className='w-full mt-4' key={item.key}>
              <label className='text-gray-900 text-sm font-medium'>{item.name}</label>
              <div className='mt-2'>
                {item.type === 'select' && (
                  <Select
                    className='w-full'
                    defaultValue={inputs[item.key]}
                    onSelect={(i) => { onInputsChange({ ...inputs, [item.key]: i.value }) }}
                    items={(item.options || []).map(i => ({ name: i, value: i }))}
                    allowSearch={false}
                    bgClassName='bg-gray-50'
                  />
                )}
                {item.type === 'string' && (
                  <input
                    type="text"
                    className="block w-full p-2 text-gray-900 border border-gray-300 rounded-lg bg-gray-50 sm:text-xs focus:ring-blue-500 focus:border-blue-500 "
                    placeholder={`${item.name}${!item.required ? `(${t('appDebug.variableTable.optional')})` : ''}`}
                    value={inputs[item.key]}
                    onChange={(e) => { onInputsChange({ ...inputs, [item.key]: e.target.value }) }}
                    maxLength={item.max_length || DEFAULT_VALUE_MAX_LEN}
                  />
                )}
                {item.type === 'paragraph' && (
                  <Textarea
                    className='h-[104px] sm:text-xs'
                    placeholder={`${item.name}${!item.required ? `(${t('appDebug.variableTable.optional')})` : ''}`}
                    value={inputs[item.key]}
                    onChange={(e) => { onInputsChange({ ...inputs, [item.key]: e.target.value }) }}
                  />
                )}
                {item.type === 'number' && (
                  <input
                    type="number"
                    className="block w-full p-2 text-gray-900 border border-gray-300 rounded-lg bg-gray-50 sm:text-xs focus:ring-blue-500 focus:border-blue-500 "
                    placeholder={`${item.name}${!item.required ? `(${t('appDebug.variableTable.optional')})` : ''}`}
                    value={inputs[item.key]}
                    onChange={(e) => { onInputsChange({ ...inputs, [item.key]: e.target.value }) }}
                  />
                )}
                {item.type === 'file' && (
                  <FileUploaderInAttachmentWrapper
                    onChange={(files) => { onInputsChange({ ...inputs, [item.key]: getProcessedFiles(files)[0] }) }}
                    fileConfig={{
                      ...item.config,
                      fileUploadConfig: (visionConfig as any).fileUploadConfig,
                    }}
                  />
                )}
                {item.type === 'file-list' && (
                  <FileUploaderInAttachmentWrapper
                    onChange={(files) => { onInputsChange({ ...inputs, [item.key]: getProcessedFiles(files) }) }}
                    fileConfig={{
                      ...item.config,
                      fileUploadConfig: (visionConfig as any).fileUploadConfig,
                    }}
                  />
                )}
              </div>
            </div>
          ))}
          {
            visionConfig?.enabled && (
              <div className="w-full mt-4">
                <div className="text-gray-900 text-sm font-medium">{t('common.imageUploader.imageUpload')}</div>
                <div className='mt-2'>
                  <TextGenerationImageUploader
                    settings={visionConfig}
                    onFilesChange={files => onVisionFilesChange(files.filter(file => file.progress !== -1).map(fileItem => ({
                      type: 'image',
                      transfer_method: fileItem.type,
                      url: fileItem.url,
                      upload_file_id: fileItem.fileId,
                    })))}
                  />
                </div>
              </div>
            )
          }
          {promptConfig.prompt_variables.length > 0 && (
            <div className='mt-4 h-[1px] bg-gray-100'></div>
          )}
          <div className='w-full mt-4'>
            <div className="flex items-center justify-between">
              <Button
                onClick={onClear}
                disabled={false}
              >
                <span className='text-[13px]'>{t('common.operation.clear')}</span>
              </Button>
              <Button
                type='submit'
                variant="primary"
                disabled={false}
              >
                <PlayIcon className="shrink-0 w-4 h-4 mr-1" aria-hidden="true" />
                <span className='text-[13px]'>{t('share.generation.run')}</span>
              </Button>
            </div>
          </div>
        </form>
      </section>
    </div>
  )
}
export default React.memo(RunOnce)
