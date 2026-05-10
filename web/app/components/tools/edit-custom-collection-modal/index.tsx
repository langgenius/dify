'use client'
import type { FC } from 'react'
import type { Credential, CustomCollectionBackend, CustomParamSchema, Emoji } from '../types'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Drawer,
  DrawerBackdrop,
  DrawerCloseButton,
  DrawerContent,
  DrawerPopup,
  DrawerPortal,
  DrawerTitle,
  DrawerViewport,
} from '@langgenius/dify-ui/drawer'
import { toast } from '@langgenius/dify-ui/toast'
import { RiSettings2Line } from '@remixicon/react'
import { useDebounce, useGetState } from 'ahooks'
import { produce } from 'immer'
import * as React from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import AppIcon from '@/app/components/base/app-icon'
import EmojiPicker from '@/app/components/base/emoji-picker'
import Input from '@/app/components/base/input'
import Textarea from '@/app/components/base/textarea'
import LabelSelector from '@/app/components/tools/labels/selector'
import { parseParamsSchema } from '@/service/tools'
import { LinkExternal02 } from '../../base/icons/src/vender/line/general'
import { AuthHeaderPrefix, AuthType } from '../types'
import ConfigCredentials from './config-credentials'
import GetSchema from './get-schema'
import TestApi from './test-api'

type Props = {
  positionLeft?: boolean
  dialogClassName?: string
  payload: any
  onHide: () => void
  onAdd?: (payload: CustomCollectionBackend) => void
  onRemove?: () => void
  onEdit?: (payload: CustomCollectionBackend) => void
}
// Add and Edit
const EditCustomCollectionModal: FC<Props> = ({
  positionLeft,
  dialogClassName = '',
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
  const [labels, setLabels] = useState<string[]>(payload?.labels || [])
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

  // Sync customCollection state when payload changes
  useEffect(() => {
    if (isEdit) {
      setCustomCollection(payload)
      setParamsSchemas(payload.tools || [])
      setLabels(payload.labels || [])
    }
  }, [isEdit, payload])

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
      errorMessage = t('errorMsg.fieldRequired', { ns: 'common', field: t('createTool.name', { ns: 'tools' }) })

    if (!postData.schema)
      errorMessage = t('errorMsg.fieldRequired', { ns: 'common', field: t('createTool.schema', { ns: 'tools' }) })

    if (errorMessage) {
      toast.error(errorMessage)
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
      <Drawer
        open
        modal
        disablePointerDismissal
        swipeDirection="right"
        onOpenChange={(open) => {
          if (!open)
            onHide()
        }}
      >
        <DrawerPortal>
          <DrawerBackdrop forceRender />
          <DrawerViewport className={dialogClassName}>
            <DrawerPopup
              className={cn(
                'data-[swipe-direction=right]:top-2 data-[swipe-direction=right]:bottom-2 data-[swipe-direction=right]:h-auto data-[swipe-direction=right]:w-160 data-[swipe-direction=right]:max-w-[calc(100vw-1rem)] data-[swipe-direction=right]:rounded-xl data-[swipe-direction=right]:border-r-[0.5px] data-[swipe-direction=right]:border-divider-subtle',
                isAdd && !positionLeft
                  ? 'data-[swipe-direction=right]:right-[max(0.5rem,calc(50%_-_320px))]'
                  : 'data-[swipe-direction=right]:right-2',
              )}
            >
              <DrawerContent className="flex min-h-0 flex-1 flex-col p-0 pb-0">
                <div className="shrink-0 border-b border-divider-regular py-4">
                  <div className="flex h-6 items-center justify-between pr-5 pl-6">
                    <DrawerTitle className="min-w-0 truncate system-xl-semibold text-text-primary">
                      {t(`createTool.${isAdd ? 'title' : 'editTitle'}`, { ns: 'tools' })}
                    </DrawerTitle>
                    <DrawerCloseButton
                      aria-label={t('operation.close', { ns: 'common' })}
                      className="h-6 w-6 rounded-md"
                    />
                  </div>
                </div>
                <div className="min-h-0 flex-1">
                  <div className="flex h-full flex-col">
                    <div className="h-0 grow space-y-4 overflow-y-auto px-6 py-3">
                      <div>
                        <div className="py-2 system-sm-medium text-text-primary">
                          {t('createTool.name', { ns: 'tools' })}
                          {' '}
                          <span className="ml-1 text-red-500">*</span>
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <AppIcon size="large" onClick={() => { setShowEmojiPicker(true) }} className="cursor-pointer" icon={emoji.content} background={emoji.background} />
                          <Input
                            className="h-10 grow"
                            placeholder={t('createTool.toolNamePlaceHolder', { ns: 'tools' })!}
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
                      <div className="select-none">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center">
                            <div className="py-2 system-sm-medium text-text-primary">
                              {t('createTool.schema', { ns: 'tools' })}
                              <span className="ml-1 text-red-500">*</span>
                            </div>
                            <div className="mx-2 h-3 w-px bg-divider-regular"></div>
                            <a
                              href="https://swagger.io/specification/"
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex h-[18px] items-center space-x-1 text-text-accent"
                            >
                              <div className="text-xs font-normal">{t('createTool.viewSchemaSpec', { ns: 'tools' })}</div>
                              <LinkExternal02 className="h-3 w-3" />
                            </a>
                          </div>
                          <GetSchema onChange={setSchema} />

                        </div>
                        <Textarea
                          className="h-[240px] resize-none"
                          value={schema}
                          onChange={e => setSchema(e.target.value)}
                          placeholder={t('createTool.schemaPlaceHolder', { ns: 'tools' })!}
                        />
                      </div>

                      {/* Available Tools  */}
                      <div>
                        <div className="py-2 system-sm-medium text-text-primary">{t('createTool.availableTools.title', { ns: 'tools' })}</div>
                        <div className="w-full overflow-x-auto rounded-lg border border-divider-regular">
                          <table className="w-full system-xs-regular text-text-secondary">
                            <thead className="text-text-tertiary uppercase">
                              <tr className={cn(paramsSchemas.length > 0 && 'border-b', 'border-divider-regular')}>
                                <th className="p-2 pl-3 font-medium">{t('createTool.availableTools.name', { ns: 'tools' })}</th>
                                <th className="w-[236px] p-2 pl-3 font-medium">{t('createTool.availableTools.description', { ns: 'tools' })}</th>
                                <th className="p-2 pl-3 font-medium">{t('createTool.availableTools.method', { ns: 'tools' })}</th>
                                <th className="p-2 pl-3 font-medium">{t('createTool.availableTools.path', { ns: 'tools' })}</th>
                                <th className="w-[54px] p-2 pl-3 font-medium">{t('createTool.availableTools.action', { ns: 'tools' })}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {paramsSchemas.map((item, index) => (
                                <tr key={index} className="border-b border-divider-regular last:border-0">
                                  <td className="p-2 pl-3">{item.operation_id}</td>
                                  <td className="w-[236px] p-2 pl-3">{item.summary}</td>
                                  <td className="p-2 pl-3">{item.method}</td>
                                  <td className="p-2 pl-3">{getPath(item.server_url)}</td>
                                  <td className="w-[62px] p-2 pl-3">
                                    <Button
                                      size="small"
                                      onClick={() => {
                                        setCurrTool(item)
                                        setIsShowTestApi(true)
                                      }}
                                    >
                                      {t('createTool.availableTools.test', { ns: 'tools' })}
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
                        <div className="py-2 system-sm-medium text-text-primary">{t('createTool.authMethod.title', { ns: 'tools' })}</div>
                        <div className="flex h-9 cursor-pointer items-center justify-between rounded-lg bg-components-input-bg-normal px-2.5" onClick={() => setCredentialsModalShow(true)}>
                          <div className="system-xs-regular text-text-primary">{t(`createTool.authMethod.types.${credential.auth_type}`, { ns: 'tools' })}</div>
                          <RiSettings2Line className="h-4 w-4 text-text-secondary" />
                        </div>
                      </div>

                      {/* Labels */}
                      <div>
                        <div className="py-2 system-sm-medium text-text-primary">{t('createTool.toolInput.label', { ns: 'tools' })}</div>
                        <LabelSelector value={labels} onChange={handleLabelSelect} />
                      </div>

                      {/* Privacy Policy */}
                      <div>
                        <div className="py-2 system-sm-medium text-text-primary">{t('createTool.privacyPolicy', { ns: 'tools' })}</div>
                        <Input
                          value={customCollection.privacy_policy}
                          onChange={(e) => {
                            const newCollection = produce(customCollection, (draft) => {
                              draft.privacy_policy = e.target.value
                            })
                            setCustomCollection(newCollection)
                          }}
                          className="h-10 grow"
                          placeholder={t('createTool.privacyPolicyPlaceholder', { ns: 'tools' }) || ''}
                        />
                      </div>

                      <div>
                        <div className="py-2 system-sm-medium text-text-primary">{t('createTool.customDisclaimer', { ns: 'tools' })}</div>
                        <Input
                          value={customCollection.custom_disclaimer}
                          onChange={(e) => {
                            const newCollection = produce(customCollection, (draft) => {
                              draft.custom_disclaimer = e.target.value
                            })
                            setCustomCollection(newCollection)
                          }}
                          className="h-10 grow"
                          placeholder={t('createTool.customDisclaimerPlaceholder', { ns: 'tools' }) || ''}
                        />
                      </div>

                    </div>
                    <div className={cn(isEdit ? 'justify-between' : 'justify-end', 'mt-2 flex shrink-0 rounded-b-[10px] border-t border-divider-regular bg-background-section-burn px-6 py-4')}>
                      {
                        isEdit && (
                          <Button variant="primary" tone="destructive" onClick={onRemove}>{t('operation.delete', { ns: 'common' })}</Button>
                        )
                      }
                      <div className="flex space-x-2">
                        <Button onClick={onHide}>{t('operation.cancel', { ns: 'common' })}</Button>
                        <Button variant="primary" onClick={handleSave}>{t('operation.save', { ns: 'common' })}</Button>
                      </div>
                    </div>
                    {showEmojiPicker && (
                      <EmojiPicker
                        onSelect={(icon, icon_background) => {
                          setEmoji({ content: icon, background: icon_background })
                          setShowEmojiPicker(false)
                        }}
                        onClose={() => {
                          setShowEmojiPicker(false)
                        }}
                      />
                    )}
                    {credentialsModalShow && (
                      <ConfigCredentials
                        positionCenter={isAdd}
                        credential={credential}
                        onChange={setCredential}
                        onHide={() => setCredentialsModalShow(false)}
                      />
                    )}
                    {isShowTestApi && (
                      <TestApi
                        positionCenter={isAdd}
                        tool={currTool as CustomParamSchema}
                        customCollection={customCollection}
                        onHide={() => setIsShowTestApi(false)}
                      />
                    )}
                  </div>
                </div>
              </DrawerContent>
            </DrawerPopup>
          </DrawerViewport>
        </DrawerPortal>
      </Drawer>
    </>

  )
}
export default React.memo(EditCustomCollectionModal)
