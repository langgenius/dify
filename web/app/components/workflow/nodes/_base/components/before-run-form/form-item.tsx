'use client'
import type { FC } from 'react'
import React, { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import produce from 'immer'
import type { InputVar } from '../../../../types'
import { BlockEnum, InputVarType } from '../../../../types'
import CodeEditor from '../editor/code-editor'
import { CodeLanguage } from '../../../code/types'
import Select from '@/app/components/base/select'
import TextGenerationImageUploader from '@/app/components/base/image-uploader/text-generation-image-uploader'
import { Resolution } from '@/types/app'
import { Trash03 } from '@/app/components/base/icons/src/vender/line/general'
import { useFeatures } from '@/app/components/base/features/hooks'
import { VarBlockIcon } from '@/app/components/workflow/block-icon'
import { Line3 } from '@/app/components/base/icons/src/public/common'
import { Variable02 } from '@/app/components/base/icons/src/vender/solid/development'

type Props = {
  payload: InputVar
  value: any
  onChange: (value: any) => void
  className?: string
}

const FormItem: FC<Props> = ({
  payload,
  value,
  onChange,
  className,
}) => {
  const { t } = useTranslation()
  const { type } = payload
  const fileSettings = useFeatures(s => s.features.file)
  const handleContextItemChange = useCallback((index: number) => {
    return (newValue: any) => {
      const newValues = produce(value, (draft: any) => {
        draft[index] = newValue
      })
      onChange(newValues)
    }
  }, [value, onChange])

  const handleContextItemRemove = useCallback((index: number) => {
    return () => {
      const newValues = produce(value, (draft: any) => {
        draft.splice(index, 1)
      })
      onChange(newValues)
    }
  }, [value, onChange])
  const nodeKey = (() => {
    if (typeof payload.label === 'object') {
      const { nodeType, nodeName, variable } = payload.label
      return (
        <div className='h-full flex items-center'>
          <div className='flex items-center'>
            <div className='p-[1px]'>
              <VarBlockIcon type={nodeType || BlockEnum.Start} />
            </div>
            <div className='mx-0.5 text-xs font-medium text-gray-700 max-w-[150px] truncate' title={nodeName}>
              {nodeName}
            </div>
            <Line3 className='mr-0.5'></Line3>
          </div>

          <div className='flex items-center text-primary-600'>
            <Variable02 className='w-3.5 h-3.5' />
            <div className='ml-0.5 text-xs font-medium max-w-[150px] truncate' title={variable} >
              {variable}
            </div>
          </div>
        </div>
      )
    }
    return ''
  })()
  return (
    <div className={`${className}`}>
      {type !== InputVarType.contexts && <div className='h-8 leading-8 text-[13px] font-medium text-gray-700 truncate'>{typeof payload.label === 'object' ? nodeKey : payload.label}</div>}
      <div className='grow'>
        {
          type === InputVarType.textInput && (
            <input
              className="w-full px-3 text-sm leading-8 text-gray-900 border-0 rounded-lg grow h-8 bg-gray-50 focus:outline-none focus:ring-1 focus:ring-inset focus:ring-gray-200"
              type="text"
              value={value || ''}
              onChange={e => onChange(e.target.value)}
              placeholder={t('appDebug.variableConig.inputPlaceholder')!}
            />
          )
        }

        {
          type === InputVarType.number && (
            <input
              className="w-full px-3 text-sm leading-8 text-gray-900 border-0 rounded-lg grow h-8 bg-gray-50 focus:outline-none focus:ring-1 focus:ring-inset focus:ring-gray-200"
              type="number"
              value={value || ''}
              onChange={e => onChange(e.target.value)}
              placeholder={t('appDebug.variableConig.inputPlaceholder')!}
            />
          )
        }

        {
          type === InputVarType.paragraph && (
            <textarea
              className="w-full px-3 py-1 text-sm leading-[18px] text-gray-900 border-0 rounded-lg grow h-[120px] bg-gray-50 focus:outline-none focus:ring-1 focus:ring-inset focus:ring-gray-200"
              value={value || ''}
              onChange={e => onChange(e.target.value)}
              placeholder={t('appDebug.variableConig.inputPlaceholder')!}
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

        {
          type === InputVarType.files && (
            <TextGenerationImageUploader
              settings={{
                ...fileSettings.image,
                detail: Resolution.high,
              }}
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
          type === InputVarType.contexts && (
            <div className='space-y-2'>
              {(value || []).map((item: any, index: number) => (
                <CodeEditor
                  key={index}
                  value={item}
                  title={<span>JSON</span>}
                  headerRight={
                    (value as any).length > 1
                      ? (<Trash03
                        onClick={handleContextItemRemove(index)}
                        className='mr-1 w-3.5 h-3.5 text-gray-500 cursor-pointer'
                      />)
                      : undefined
                  }
                  language={CodeLanguage.json}
                  onChange={handleContextItemChange(index)}
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
