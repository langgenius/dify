'use client'
import type { FC } from 'react'
import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useDebounce, useGetState } from 'ahooks'
import { produce } from 'immer'
import { LinkExternal02, Settings01 } from '../../base/icons/src/vender/line/general'
import type { Credential, CustomCollectionBackend, CustomParamSchema, Emoji } from '../types'
import { AuthHeaderPrefix, AuthType } from '../types'
import GetSchema from './get-schema'
import ConfigCredentials from './config-credentials'
import TestApi from './test-api'
import cn from '@/utils/classnames'
import Input from '@/app/components/base/input'
import Textarea from '@/app/components/base/textarea'
import EmojiPicker from '@/app/components/base/emoji-picker'
import AppIcon from '@/app/components/base/app-icon'
import { parseParamsSchema } from '@/service/tools'
import LabelSelector from '@/app/components/tools/labels/selector'
import Toast from '@/app/components/base/toast'
import Modal from '../../base/modal'
import Button from '@/app/components/base/button'

type Props = {
  positionLeft?: boolean
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
  const setSchema = (schema: any) => {
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
      try {
        const { parameters_schema, schema_type } = await parseParamsSchema(debouncedSchema)
        const customCollection = getCustomCollection()
        const newCollection = produce(customCollection, (draft) => {
          draft.schema_type = schema_type
        })
        setCustomCollection(newCollection)
        setParamsSchemas(parameters_schema)
      }
      catch {
        const customCollection = getCustomCollection()
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

  const [labels, setLabels] = useState<string[]>(payload?.labels || [])
  const handleLabelSelect = (value: string[]) => {
    setLabels(value)
  }

  const handleSave = () => {
    // const postData = clone(customCollection)
    const postData = produce(customCollection, (draft) => {
      delete draft.tools

      if (draft.credentials.auth_type === AuthType.none) {
        delete draft.credentials.api_key_header
        delete draft.credentials.api_key_header_prefix
        delete draft.credentials.api_key_value
      }

      draft.labels = labels
    })

    let errorMessage = ''
    if (!postData.provider)
      errorMessage = t('common.errorMsg.fieldRequired', { field: t('tools.createTool.name') })

    if (!postData.schema)
      errorMessage = t('common.errorMsg.fieldRequired', { field: t('tools.createTool.schema') })

    if (errorMessage) {
      Toast.notify({
        type: 'error',
        message: errorMessage,
      })
      return
    }

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
      const path = decodeURI(new URL(url).pathname)
      return path || ''
    }
    catch {
      return url
    }
  }

  return (
    <>
      <Modal
        isShow
        onClose={onHide}
        closable
        className='!h-[calc(100vh-16px)] !max-w-[630px] !p-0'
        wrapperClassName='z-[1000]'
      >
        <div className='flex h-full flex-col'>
          <div className='ml-6 mt-6 text-base font-semibold text-text-primary'>
            {t('tools.createTool.title')}
          </div>
          <div className='h-0 grow space-y-4 overflow-y-auto px-6 py-3'>
            <div>
              <div className='system-sm-medium py-2 text-text-primary'>{t('tools.createTool.name')} <span className='ml-1 text-red-500'>*</span></div>
              <div className='flex items-center justify-between gap-3'>
                <AppIcon size='large' onClick={() => { setShowEmojiPicker(true) }} className='cursor-pointer' icon={emoji.content} background={emoji.background} />
                <Input
                  className='h-10 grow' placeholder={t('tools.createTool.toolNamePlaceHolder')!}
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
              <div className='flex items-center justify-between'>
                <div className='flex items-center'>
                  <div className='system-sm-medium py-2 text-text-primary'>{t('tools.createTool.schema')}<span className='ml-1 text-red-500'>*</span></div>
                  <div className='mx-2 h-3 w-px bg-divider-regular'></div>
                  <a
                    href="https://swagger.io/specification/"
                    target='_blank' rel='noopener noreferrer'
                    className='flex h-[18px] items-center space-x-1  text-text-accent'
                  >
                    <div className='text-xs font-normal'>{t('tools.createTool.viewSchemaSpec')}</div>
                    <LinkExternal02 className='h-3 w-3' />
                  </a>
                </div>
                <GetSchema onChange={setSchema} />

              </div>
              <Textarea
                className='h-[240px] resize-none'
                value={schema}
                onChange={e => setSchema(e.target.value)}
                placeholder={t('tools.createTool.schemaPlaceHolder')!}
              />
            </div>

            {/* Available Tools  */}
            <div>
              <div className='system-sm-medium py-2 text-text-primary'>{t('tools.createTool.availableTools.title')}</div>
              <div className='w-full overflow-x-auto rounded-lg border border-divider-regular'>
                <table className='system-xs-regular w-full text-text-secondary'>
                  <thead className='uppercase text-text-tertiary'>
                    <tr className={cn(paramsSchemas.length > 0 && 'border-b', 'border-divider-regular')}>
                      <th className="p-2 pl-3 font-medium">{t('tools.createTool.availableTools.name')}</th>
                      <th className="w-[236px] p-2 pl-3 font-medium">{t('tools.createTool.availableTools.description')}</th>
                      <th className="p-2 pl-3 font-medium">{t('tools.createTool.availableTools.method')}</th>
                      <th className="p-2 pl-3 font-medium">{t('tools.createTool.availableTools.path')}</th>
                      <th className="w-[54px] p-2 pl-3 font-medium">{t('tools.createTool.availableTools.action')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paramsSchemas.map((item, index) => (
                      <tr key={index} className='border-b border-divider-regular last:border-0'>
                        <td className="p-2 pl-3">{item.operation_id}</td>
                        <td className="w-[236px] p-2 pl-3">{item.summary}</td>
                        <td className="p-2 pl-3">{item.method}</td>
                        <td className="p-2 pl-3">{getPath(item.server_url)}</td>
                        <td className="w-[62px] p-2 pl-3">
                          <Button
                            size='small'
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
              <div className='system-sm-medium py-2 text-text-primary'>{t('tools.createTool.authMethod.title')}</div>
              <div className='flex h-9 cursor-pointer items-center justify-between rounded-lg bg-components-input-bg-normal px-2.5' onClick={() => setCredentialsModalShow(true)}>
                <div className='system-xs-regular text-text-primary'>{t(`tools.createTool.authMethod.types.${credential.auth_type}`)}</div>
                <Settings01 className='h-4 w-4 text-text-secondary' />
              </div>
            </div>

            {/* Labels */}
            <div>
              <div className='system-sm-medium py-2 text-text-primary'>{t('tools.createTool.toolInput.label')}</div>
              <LabelSelector value={labels} onChange={handleLabelSelect} />
            </div>

            {/* Privacy Policy */}
            <div>
              <div className='system-sm-medium py-2 text-text-primary'>{t('tools.createTool.privacyPolicy')}</div>
              <Input
                value={customCollection.privacy_policy}
                onChange={(e) => {
                  const newCollection = produce(customCollection, (draft) => {
                    draft.privacy_policy = e.target.value
                  })
                  setCustomCollection(newCollection)
                }}
                className='h-10 grow' placeholder={t('tools.createTool.privacyPolicyPlaceholder') || ''} />
            </div>

            <div>
              <div className='system-sm-medium py-2 text-text-primary'>{t('tools.createTool.customDisclaimer')}</div>
              <Input
                value={customCollection.custom_disclaimer}
                onChange={(e) => {
                  const newCollection = produce(customCollection, (draft) => {
                    draft.custom_disclaimer = e.target.value
                  })
                  setCustomCollection(newCollection)
                }}
                className='h-10 grow' placeholder={t('tools.createTool.customDisclaimerPlaceholder') || ''} />
            </div>

          </div>
          <div className={cn(isEdit ? 'justify-between' : 'justify-end', 'mt-2 flex shrink-0 rounded-b-[10px] border-t border-divider-regular bg-background-section-burn px-6 py-4')} >
            {
              isEdit && (
                <Button variant='warning' onClick={onRemove}>{t('common.operation.delete')}</Button>
              )
            }
            <div className='flex space-x-2 '>
              <Button onClick={onHide}>{t('common.operation.cancel')}</Button>
              <Button variant='primary' onClick={handleSave}>{t('common.operation.save')}</Button>
            </div>
          </div>
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
              positionCenter={isAdd}
              credential={credential}
              onChange={setCredential}
              onHide={() => setCredentialsModalShow(false)}
            />)
          }
          {isShowTestApi && (
            <TestApi
              positionCenter={isAdd}
              tool={currTool as CustomParamSchema}
              customCollection={customCollection}
              onHide={() => setIsShowTestApi(false)}
            />
          )}
        </div>
      </Modal>
    </>

  )
}
export default React.memo(EditCustomCollectionModal)
