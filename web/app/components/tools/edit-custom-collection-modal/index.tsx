'use client'
import type { FC } from 'react'
import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import produce from 'immer'
import { useDebounce, useGetState } from 'ahooks'
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
  onEdit?: (payload: CustomCollectionBackend) => void
}
// Add and Edit
const EditCustomCollectionModal: FC<Props> = ({
  payload,
  onHide,
  onAdd,
  onEdit,
}) => {
  const { t } = useTranslation()
  const isAdd = !payload

  const [paramsSchemas, setParamsSchemas] = useState<CustomParamSchema[]>([])
  const [customCollection, setCustomCollection, getCustomCollection] = useGetState<CustomCollectionBackend>(isAdd
    ? {
      provider: '',
      credentials: {
        auth_type: AuthType.none,
      },
      icon: {
        icon: '🕵️',
        icon_background: '#FEF7C3',
      },
      schema_type: '',
      schema: '',
    }
    : payload)

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
    (async () => {
      const customCollection = getCustomCollection()
      try {
        const { parameters_schema, schema_type } = await parseParamsSchema(debouncedSchema) as any
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
    if (isAdd)
      onAdd?.(customCollection)

    else
      onEdit?.(customCollection)
  }

  return (
    <>
      <Drawer
        isShow
        onHide={onHide}
        title={t('tools.createTool.title') as string}
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
                      target='_blank'
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
                <div className='rounded-lg border border-gray-200'>
                  <table className='w-full leading-[18px] text-xs text-gray-700 font-normal'>
                    <thead className='text-gray-500 uppercase'>
                      <tr className='border-b border-gray-200'>
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
                          <td className="p-2 pl-3">{item.server_url ? item.server_url.split('/').slice(1).join('/') : ''}</td>
                          <td className="p-2 pl-3 w-[54px]">
                            <Button
                              className='!h-6 !px-2 text-xs font-medium text-gray-700'
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
            <div className='shrink-0 flex justify-end space-x-2 py-4 pr-6 rounded-b-[10px] bg-gray-50 border-t border-black/5'>
              <Button className='flex items-center h-8 !px-3 !text-[13px] font-medium !text-gray-700' onClick={onHide}>{t('common.operation.cancel')}</Button>
              <Button className='flex items-center h-8 !px-3 !text-[13px] font-medium' type='primary' onClick={handleSave}>{t('common.operation.save')}</Button>
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
