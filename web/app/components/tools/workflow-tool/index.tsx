'use client'
import type { FC } from 'react'
import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useDebounce, useGetState } from 'ahooks'
import cn from 'classnames'
import produce from 'immer'
import type { CustomCollectionBackend, CustomParamSchema, Emoji } from '../types'
import { AuthHeaderPrefix, AuthType } from '../types'
import Drawer from '@/app/components/base/drawer-plus'
import Button from '@/app/components/base/button'
import EmojiPicker from '@/app/components/base/emoji-picker'
import AppIcon from '@/app/components/base/app-icon'
import { parseParamsSchema } from '@/service/tools'

type Props = {
  payload: any
  onHide: () => void
  onAdd?: (payload: CustomCollectionBackend) => void
  onRemove?: () => void
  onEdit?: (payload: CustomCollectionBackend) => void
}
// Add and Edit
const WorkflowToolAsModal: FC<Props> = ({
  payload,
  onHide,
  onAdd,
  onEdit,
  onRemove,
}) => {
  const { t } = useTranslation()
  const isAdd = !payload
  const isEdit = !!payload

  const [editFirst, setEditFirst] = useState(!isAdd)
  const [paramsSchemas, setParamsSchemas] = useState<CustomParamSchema[]>(payload?.tools || [])
  const [customCollection, setCustomCollection, getCustomCollection] = useGetState<CustomCollectionBackend>(isAdd
    ? {
      provider: '',
      credentials: {
        auth_type: AuthType.none,
        api_key_header: 'Authorization',
        api_key_header_prefix: AuthHeaderPrefix.basic,
      },
      icon: {
        content: '🕵️',
        background: '#FEF7C3',
      },
      schema_type: '',
      schema: '',
    }
    : payload)

  const originalProvider = isEdit ? payload.provider : ''

  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
  const emoji = customCollection.icon
  const setEmoji = (emoji: Emoji) => {
    const newCollection = produce(customCollection, (draft) => {
      draft.icon = emoji
    })
    setCustomCollection(newCollection)
  }
  const schema = customCollection.schema
  const debouncedSchema = useDebounce(schema, { wait: 500 })
  const setSchema = (schema: string) => {
    const newCollection = produce(customCollection, (draft) => {
      draft.schema = schema
    })
    setCustomCollection(newCollection)
  }

  useEffect(() => {
    if (!debouncedSchema)
      return
    if (isEdit && editFirst) {
      setEditFirst(false)
      return
    }
    (async () => {
      const customCollection = getCustomCollection()
      try {
        const { parameters_schema, schema_type } = await parseParamsSchema(debouncedSchema)
        const newCollection = produce(customCollection, (draft) => {
          draft.schema_type = schema_type
        })
        setCustomCollection(newCollection)
        setParamsSchemas(parameters_schema)
      }
      catch (e) {
        const newCollection = produce(customCollection, (draft) => {
          draft.schema_type = ''
        })
        setCustomCollection(newCollection)
        setParamsSchemas([])
      }
    })()
  }, [debouncedSchema])

  const handleSave = () => {
    // const postData = clone(customCollection)
    const postData = produce(customCollection, (draft) => {
      delete draft.tools

      if (draft.credentials.auth_type === AuthType.none) {
        delete draft.credentials.api_key_header
        delete draft.credentials.api_key_header_prefix
        delete draft.credentials.api_key_value
      }
    })

    if (isAdd) {
      onAdd?.(postData)
      return
    }

    onEdit?.({
      ...postData,
      original_provider: originalProvider,
    })
  }

  return (
    <>
      <Drawer
        isShow
        onHide={onHide}
        title={t(`tools.createTool.${isAdd ? 'title' : 'editTitle'}`)!}
        panelClassName='mt-2 !w-[640px]'
        maxWidthClassName='!max-w-[640px]'
        height='calc(100vh - 16px)'
        headerClassName='!border-b-black/5'
        body={
          <div className='flex flex-col h-full'>
            <div className='grow h-0 overflow-y-auto px-6 py-3 space-y-4'>
              <div>
                <div className='py-2 leading-5 text-sm font-medium text-gray-900'>{t('tools.createTool.name')}</div>
                <div className='flex items-center justify-between gap-3'>
                  <AppIcon size='large' onClick={() => { setShowEmojiPicker(true) }} className='cursor-pointer' icon={emoji.content} background={emoji.background} />
                  <input
                    className='grow h-10 px-3 text-sm font-normal bg-gray-100 rounded-lg border border-transparent outline-none appearance-none caret-primary-600 placeholder:text-gray-400 hover:bg-gray-50 hover:border hover:border-gray-300 focus:bg-gray-50 focus:border focus:border-gray-300 focus:shadow-xs'
                    placeholder={t('tools.createTool.toolNamePlaceHolder')!}
                    value={customCollection.provider}
                    onChange={(e) => {
                      const newCollection = produce(customCollection, (draft) => {
                        draft.provider = e.target.value
                      })
                      setCustomCollection(newCollection)
                    }}
                  />
                </div>
              </div>
              <div>
                {/* description */}
                <div className='py-2 leading-5 text-sm font-medium text-gray-900'>{t('tools.createTool.description')}</div>
                <textarea
                  className='w-full h-10 px-3 py-2 text-sm font-normal bg-gray-100 rounded-lg border border-transparent outline-none appearance-none caret-primary-600 placeholder:text-gray-400 hover:bg-gray-50 hover:border hover:border-gray-300 focus:bg-gray-50 focus:border focus:border-gray-300 focus:shadow-xs h-[80px] resize-none'
                  placeholder={t('tools.createTool.descriptionPlacehoder') || ''}
                  value={''}
                  onChange={() => {}}
                />
              </div>

              {/* Tool Input  */}
              <div>
                <div className='py-2 leading-5 text-sm font-medium text-gray-900'>{t('tools.createTool.toolInput.title')}</div>
                <div className='rounded-lg border border-gray-200 w-full overflow-x-auto'>
                  <table className='w-full leading-[18px] text-xs text-gray-700 font-normal'>
                    <thead className='text-gray-500 uppercase'>
                      <tr className={cn(paramsSchemas.length > 0 && 'border-b', 'border-gray-200')}>
                        <th className="p-2 pl-3 font-medium">{t('tools.createTool.toolInput.name')}</th>
                        <th className="p-2 pl-3 font-medium">{t('tools.createTool.toolInput.method')}</th>
                        <th className="p-2 pl-3 font-medium w-[236px]">{t('tools.createTool.toolInput.description')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paramsSchemas.map((item, index) => (
                        <tr key={index} className='border-b last:border-0 border-gray-200'>
                          <td className="p-2 pl-3">{item.operation_id}</td>
                          <td className="p-2 pl-3">{item.method}</td>
                          <td className="p-2 pl-3 text-gray-500 w-[236px]">{item.summary}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              {/* Label */}
              <div>
                <div className='py-2 leading-5 text-sm font-medium text-gray-900'>{t('tools.createTool.toolInput.label')}</div>
                <input
                  value={customCollection.privacy_policy}
                  onChange={(e) => {
                    const newCollection = produce(customCollection, (draft) => {
                      draft.privacy_policy = e.target.value
                    })
                    setCustomCollection(newCollection)
                  }}
                  className='grow h-10 px-3 text-sm font-normal bg-gray-100 rounded-lg border border-transparent outline-none appearance-none caret-primary-600 placeholder:text-gray-400 hover:bg-gray-50 hover:border hover:border-gray-300 focus:bg-gray-50 focus:border focus:border-gray-300 focus:shadow-xs' placeholder={t('tools.createTool.toolInput.labelPlaceholder') || ''} />
              </div>
              {/* Privacy Policy */}
              <div>
                <div className='py-2 leading-5 text-sm font-medium text-gray-900'>{t('tools.createTool.privacyPolicy')}</div>
                <input
                  value={customCollection.privacy_policy}
                  onChange={(e) => {
                    const newCollection = produce(customCollection, (draft) => {
                      draft.privacy_policy = e.target.value
                    })
                    setCustomCollection(newCollection)
                  }}
                  className='grow h-10 px-3 text-sm font-normal bg-gray-100 rounded-lg border border-transparent outline-none appearance-none caret-primary-600 placeholder:text-gray-400 hover:bg-gray-50 hover:border hover:border-gray-300 focus:bg-gray-50 focus:border focus:border-gray-300 focus:shadow-xs' placeholder={t('tools.createTool.privacyPolicyPlaceholder') || ''} />
              </div>

            </div>
            <div className={cn(isEdit ? 'justify-between' : 'justify-end', 'mt-2 shrink-0 flex py-4 px-6 rounded-b-[10px] bg-gray-50 border-t border-black/5')} >
              {
                isEdit && (
                  <Button className='flex items-center h-8 !px-3 !text-[13px] font-medium !text-gray-700' onClick={onRemove}>{t('common.operation.remove')}</Button>
                )
              }
              <div className='flex space-x-2 '>
                <Button className='flex items-center h-8 !px-3 !text-[13px] font-medium !text-gray-700' onClick={onHide}>{t('common.operation.cancel')}</Button>
                <Button className='flex items-center h-8 !px-3 !text-[13px] font-medium' type='primary' onClick={handleSave}>{t('common.operation.save')}</Button>
              </div>
            </div>
          </div>
        }
        isShowMask={true}
        clickOutsideNotOpen={true}
      />
      {showEmojiPicker && <EmojiPicker
        onSelect={(icon, icon_background) => {
          setEmoji({ content: icon, background: icon_background })
          setShowEmojiPicker(false)
        }}
        onClose={() => {
          setShowEmojiPicker(false)
        }}
      />}
    </>

  )
}
export default React.memo(WorkflowToolAsModal)
