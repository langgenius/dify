'use client'
import type { FC } from 'react'
import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import produce from 'immer'
import { useDebounce, useGetState } from 'ahooks'
import { clone } from 'lodash-es'
import cn from 'classnames'
import { LinkExternal02, Settings01 } from '../../base/icons/src/vender/line/general'
import type { Credential, CustomCollectionBackend, CustomParamSchema, Emoji } from '../types'
import { AuthType } from '../types'
import GetSchema from './get-schema'
import ConfigCredentials from './config-credentials'
import TestApi from './test-api'
import Drawer from '@/app/components/base/drawer-plus'
import Button from '@/app/components/base/button'
import EmojiPicker from '@/app/components/base/emoji-picker'
import AppIcon from '@/app/components/base/app-icon'
import { parseParamsSchema } from '@/service/tools'

const fieldNameClassNames = 'py-2 leading-5 text-sm font-medium text-gray-900'
type Props = {
  payload: any
  onHide: () => void
  onAdd?: (payload: CustomCollectionBackend) => void
  onRemove?: () => void
  onEdit?: (payload: CustomCollectionBackend) => void
}
// Add and Edit
const EditCustomCollectionModal: FC<Props> = ({
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

  const [credentialsModalShow, setCredentialsModalShow] = useState(false)
  const credential = customCollection.credentials
  const setCredential = (credential: Credential) => {
    const newCollection = produce(customCollection, (draft) => {
      draft.credentials = credential
    })
    setCustomCollection(newCollection)
  }

  const [currTool, setCurrTool] = useState<CustomParamSchema | null>(null)
  const [isShowTestApi, setIsShowTestApi] = useState(false)

  const handleSave = () => {
    const postData = clone(customCollection)
    delete postData.tools
    if (isAdd) {
      onAdd?.(postData)
      return
    }

    onEdit?.({
      ...postData,
      original_provider: originalProvider,
    })
  }

  const getPath = (url: string) => {
    if (!url)
      return ''

    try {
      const path = new URL(url).pathname
      return path || ''
    }
    catch (e) {
      return url
    }
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
                <div className={fieldNameClassNames}>{t('tools.createTool.name')}</div>
                <div className='flex items-center justify-between gap-3'>
                  <AppIcon size='large' onClick={() => { setShowEmojiPicker(true) }} className='cursor-pointer' icon={emoji.content} background={emoji.background} />
                  <input
                    className='h-10 px-3 text-sm font-normal bg-gray-100 rounded-lg grow' placeholder={t('tools.createTool.toolNamePlaceHolder')!}
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

              {/* Schema */}
              <div className='select-none'>
                <div className='flex justify-between items-center'>
                  <div className='flex items-center'>
                    <div className={fieldNameClassNames}>{t('tools.createTool.schema')}</div>
                    <div className='mx-2 w-px h-3 bg-black/5'></div>
                    <a
                      href="https://swagger.io/specification/"
                      target='_blank' rel='noopener noreferrer'
                      className='flex items-center h-[18px] space-x-1  text-[#155EEF]'
                    >
                      <div className='text-xs font-normal'>{t('tools.createTool.viewSchemaSpec')}</div>
                      <LinkExternal02 className='w-3 h-3' />
                    </a>
                  </div>
                  <GetSchema onChange={setSchema} />

                </div>
                <textarea
                  value={schema}
                  onChange={e => setSchema(e.target.value)}
                  className='w-full h-[240px] px-3 py-2 leading-4 text-xs font-normal text-gray-900 bg-gray-100 rounded-lg overflow-y-auto'
                  placeholder={t('tools.createTool.schemaPlaceHolder')!}
                ></textarea>
              </div>

              {/* Available Tools  */}
              <div>
                <div className={fieldNameClassNames}>{t('tools.createTool.availableTools.title')}</div>
                <div className='rounded-lg border border-gray-200 w-full overflow-x-auto'>
                  <table className='w-full leading-[18px] text-xs text-gray-700 font-normal'>
                    <thead className='text-gray-500 uppercase'>
                      <tr className={cn(paramsSchemas.length > 0 && 'border-b', 'border-gray-200')}>
                        <th className="p-2 pl-3 font-medium">{t('tools.createTool.availableTools.name')}</th>
                        <th className="p-2 pl-3 font-medium w-[236px]">{t('tools.createTool.availableTools.description')}</th>
                        <th className="p-2 pl-3 font-medium">{t('tools.createTool.availableTools.method')}</th>
                        <th className="p-2 pl-3 font-medium">{t('tools.createTool.availableTools.path')}</th>
                        <th className="p-2 pl-3 font-medium w-[54px]">{t('tools.createTool.availableTools.action')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paramsSchemas.map((item, index) => (
                        <tr key={index} className='border-b last:border-0 border-gray-200'>
                          <td className="p-2 pl-3">{item.operation_id}</td>
                          <td className="p-2 pl-3 text-gray-500 w-[236px]">{item.summary}</td>
                          <td className="p-2 pl-3">{item.method}</td>
                          <td className="p-2 pl-3">{getPath(item.server_url)}</td>
                          <td className="p-2 pl-3 w-[62px]">
                            <Button
                              className='!h-6 !px-2 text-xs font-medium text-gray-700 whitespace-nowrap'
                              onClick={() => {
                                setCurrTool(item)
                                setIsShowTestApi(true)
                              }}
                            >
                              {t('tools.createTool.availableTools.test')}
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Authorization method */}
              <div>
                <div className={fieldNameClassNames}>{t('tools.createTool.authMethod.title')}</div>
                <div className='flex items-center h-9 justify-between px-2.5 bg-gray-100 rounded-lg cursor-pointer' onClick={() => setCredentialsModalShow(true)}>
                  <div className='text-sm font-normal text-gray-900'>{t(`tools.createTool.authMethod.types.${credential.auth_type}`)}</div>
                  <Settings01 className='w-4 h-4 text-gray-700 opacity-60' />
                </div>
              </div>

              <div>
                <div className={fieldNameClassNames}>{t('tools.createTool.privacyPolicy')}</div>
                <input
                  value={customCollection.privacy_policy}
                  onChange={(e) => {
                    const newCollection = produce(customCollection, (draft) => {
                      draft.privacy_policy = e.target.value
                    })
                    setCustomCollection(newCollection)
                  }}
                  className='w-full h-10 px-3 text-sm font-normal bg-gray-100 rounded-lg grow' placeholder={t('tools.createTool.privacyPolicyPlaceholder') || ''} />
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
      {credentialsModalShow && (
        <ConfigCredentials
          credential={credential}
          onChange={setCredential}
          onHide={() => setCredentialsModalShow(false)}
        />)
      }
      {isShowTestApi && (
        <TestApi
          tool={currTool as CustomParamSchema}
          customCollection={customCollection}
          onHide={() => setIsShowTestApi(false)}
        />
      )}
    </>

  )
}
export default React.memo(EditCustomCollectionModal)
