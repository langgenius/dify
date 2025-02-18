'use client'
import type { FC } from 'react'
import React, { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import produce from 'immer'
import {
  RiDeleteBinLine,
} from '@remixicon/react'
import type { InputVar } from '../../../../types'
import { BlockEnum, InputVarType, SupportUploadFileTypes } from '../../../../types'
import CodeEditor from '../editor/code-editor'
import { CodeLanguage } from '../../../code/types'
import TextEditor from '../editor/text-editor'
import Select from '@/app/components/base/select'
import Input from '@/app/components/base/input'
import Textarea from '@/app/components/base/textarea'
import TextGenerationImageUploader from '@/app/components/base/image-uploader/text-generation-image-uploader'
import { FileUploaderInAttachmentWrapper } from '@/app/components/base/file-uploader'
import { Resolution, TransferMethod } from '@/types/app'
import { useFeatures } from '@/app/components/base/features/hooks'
import { VarBlockIcon } from '@/app/components/workflow/block-icon'
import { Line3 } from '@/app/components/base/icons/src/public/common'
import { Variable02 } from '@/app/components/base/icons/src/vender/solid/development'
import { BubbleX } from '@/app/components/base/icons/src/vender/line/others'
import { FILE_EXTS } from '@/app/components/base/prompt-editor/constants'
import cn from '@/utils/classnames'

interface Props {
  payload: InputVar
  value: any
  onChange: (value: any) => void
  className?: string
  autoFocus?: boolean
  inStepRun?: boolean
}

const FormItem: FC<Props> = ({
  payload,
  value,
  onChange,
  className,
  autoFocus,
  inStepRun = false,
}) => {
  const { t } = useTranslation()
  const { type } = payload
  const fileSettings = useFeatures(s => s.features.file)
  const handleArrayItemChange = useCallback((index: number) => {
    return (newValue: any) => {
      const newValues = produce(value, (draft: any) => {
        draft[index] = newValue
      })
      onChange(newValues)
    }
  }, [value, onChange])

  const handleArrayItemRemove = useCallback((index: number) => {
    return () => {
      const newValues = produce(value, (draft: any) => {
        draft.splice(index, 1)
      })
      onChange(newValues)
    }
  }, [value, onChange])
  const nodeKey = (() => {
    if (typeof payload.label === 'object') {
      const { nodeType, nodeName, variable, isChatVar } = payload.label
      return (
        <div className='flex h-full items-center'>
          {!isChatVar && (
            <div className='flex items-center'>
              <div className='p-[1px]'>
                <VarBlockIcon type={nodeType || BlockEnum.Start} />
              </div>
              <div className='mx-0.5 max-w-[150px] truncate text-xs font-medium text-gray-700' title={nodeName}>
                {nodeName}
              </div>
              <Line3 className='mr-0.5'></Line3>
            </div>
          )}
          <div className='text-primary-600 flex items-center'>
            {!isChatVar && <Variable02 className='h-3.5 w-3.5' />}
            {isChatVar && <BubbleX className='text-util-colors-teal-teal-700 h-3.5 w-3.5' />}
            <div className={cn('ml-0.5 max-w-[150px] truncate text-xs font-medium', isChatVar && 'text-text-secondary')} title={variable} >
              {variable}
            </div>
          </div>
        </div>
      )
    }
    return ''
  })()

  const isArrayLikeType = [InputVarType.contexts, InputVarType.iterator].includes(type)
  const isContext = type === InputVarType.contexts
  const isIterator = type === InputVarType.iterator
  return (
    <div className={cn(className)}>
      {!isArrayLikeType && (
        <div className='text-text-secondary system-sm-semibold mb-1 flex h-6 items-center gap-1'>
          <div className='truncate'>{typeof payload.label === 'object' ? nodeKey : payload.label}</div>
          {!payload.required && <span className='text-text-tertiary system-xs-regular'>{t('workflow.panel.optional')}</span>}
        </div>
      )}
      <div className='grow'>
        {
          type === InputVarType.textInput && (
            <Input
              value={value || ''}
              onChange={e => onChange(e.target.value)}
              placeholder={t('appDebug.variableConfig.inputPlaceholder')!}
              autoFocus={autoFocus}
            />
          )
        }

        {
          type === InputVarType.number && (
            <Input
              type="number"
              value={value || ''}
              onChange={e => onChange(e.target.value)}
              placeholder={t('appDebug.variableConfig.inputPlaceholder')!}
              autoFocus={autoFocus}
            />
          )
        }

        {
          type === InputVarType.paragraph && (
            <Textarea
              value={value || ''}
              onChange={e => onChange(e.target.value)}
              placeholder={t('appDebug.variableConfig.inputPlaceholder')!}
              autoFocus={autoFocus}
            />
          )
        }

        {
          type === InputVarType.select && (
            <Select
              className="w-full"
              defaultValue={value || ''}
              items={payload.options?.map(option => ({ name: option, value: option })) || []}
              onSelect={i => onChange(i.value)}
              allowSearch={false}
            />
          )
        }

        {
          type === InputVarType.json && (
            <CodeEditor
              value={value}
              title={<span>JSON</span>}
              language={CodeLanguage.json}
              onChange={onChange}
            />
          )
        }
        {(type === InputVarType.singleFile) && (
          <FileUploaderInAttachmentWrapper
            value={value ? [value] : []}
            onChange={(files) => {
              if (files.length)
                onChange(files[0])
              else
                onChange(null)
            }}
            fileConfig={{
              allowed_file_types: inStepRun
                ? [
                  SupportUploadFileTypes.image,
                  SupportUploadFileTypes.document,
                  SupportUploadFileTypes.audio,
                  SupportUploadFileTypes.video,
                ]
                : payload.allowed_file_types,
              allowed_file_extensions: inStepRun
                ? [
                  ...FILE_EXTS[SupportUploadFileTypes.image],
                  ...FILE_EXTS[SupportUploadFileTypes.document],
                  ...FILE_EXTS[SupportUploadFileTypes.audio],
                  ...FILE_EXTS[SupportUploadFileTypes.video],
                ]
                : payload.allowed_file_extensions,
              allowed_file_upload_methods: inStepRun ? [TransferMethod.local_file, TransferMethod.remote_url] : payload.allowed_file_upload_methods,
              number_limits: 1,
              fileUploadConfig: fileSettings?.fileUploadConfig,
            }}
          />
        )}
        {(type === InputVarType.multiFiles) && (
          <FileUploaderInAttachmentWrapper
            value={value}
            onChange={files => onChange(files)}
            fileConfig={{
              allowed_file_types: inStepRun
                ? [
                  SupportUploadFileTypes.image,
                  SupportUploadFileTypes.document,
                  SupportUploadFileTypes.audio,
                  SupportUploadFileTypes.video,
                ]
                : payload.allowed_file_types,
              allowed_file_extensions: inStepRun
                ? [
                  ...FILE_EXTS[SupportUploadFileTypes.image],
                  ...FILE_EXTS[SupportUploadFileTypes.document],
                  ...FILE_EXTS[SupportUploadFileTypes.audio],
                  ...FILE_EXTS[SupportUploadFileTypes.video],
                ]
                : payload.allowed_file_extensions,
              allowed_file_upload_methods: inStepRun ? [TransferMethod.local_file, TransferMethod.remote_url] : payload.allowed_file_upload_methods,
              number_limits: inStepRun ? 5 : payload.max_length,
              fileUploadConfig: fileSettings?.fileUploadConfig,
            }}
          />
        )}
        {
          type === InputVarType.files && (
            <TextGenerationImageUploader
              settings={{
                ...fileSettings,
                detail: fileSettings?.image?.detail || Resolution.high,
                transfer_methods: fileSettings?.allowed_file_upload_methods || [],
              } as any}
              onFilesChange={files => onChange(files.filter(file => file.progress !== -1).map(fileItem => ({
                type: 'image',
                transfer_method: fileItem.type,
                url: fileItem.url,
                upload_file_id: fileItem.fileId,
              })))}
            />
          )
        }

        {
          isContext && (
            <div className='space-y-2'>
              {(value || []).map((item: any, index: number) => (
                <CodeEditor
                  key={index}
                  value={item}
                  title={<span>JSON</span>}
                  headerRight={
                    (value as any).length > 1
                      ? (<RiDeleteBinLine
                        onClick={handleArrayItemRemove(index)}
                        className='text-text-tertiary mr-1 h-3.5 w-3.5 cursor-pointer'
                      />)
                      : undefined
                  }
                  language={CodeLanguage.json}
                  onChange={handleArrayItemChange(index)}
                />
              ))}
            </div>
          )
        }

        {
          isIterator && (
            <div className='space-y-2'>
              {(value || []).map((item: any, index: number) => (
                <TextEditor
                  key={index}
                  isInNode
                  value={item}
                  title={<span>{t('appDebug.variableConfig.content')} {index + 1} </span>}
                  onChange={handleArrayItemChange(index)}
                  headerRight={
                    (value as any).length > 1
                      ? (<RiDeleteBinLine
                        onClick={handleArrayItemRemove(index)}
                        className='text-text-tertiary mr-1 h-3.5 w-3.5 cursor-pointer'
                      />)
                      : undefined
                  }
                />
              ))}
            </div>
          )
        }
      </div>
    </div>
  )
}
export default React.memo(FormItem)
