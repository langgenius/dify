'use client'
import React, { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { v4 as uuid } from 'uuid'
import { getDomain } from 'tldts'
import { RiCloseLine, RiEditLine } from '@remixicon/react'
import { Mcp } from '@/app/components/base/icons/src/vender/other'
import AppIconPicker from '@/app/components/base/app-icon-picker'
import type { AppIconSelection } from '@/app/components/base/app-icon-picker'
import AppIcon from '@/app/components/base/app-icon'
import Modal from '@/app/components/base/modal'
import Button from '@/app/components/base/button'
import Input from '@/app/components/base/input'
import HeadersInput from './headers-input'
import type { HeaderItem } from './headers-input'
import type { AppIconType } from '@/types/app'
import type { ToolWithProvider } from '@/app/components/workflow/types'
import { noop } from 'lodash-es'
import Toast from '@/app/components/base/toast'
import { uploadRemoteFileInfo } from '@/service/common'
import cn from '@/utils/classnames'
import { useHover } from 'ahooks'
import { shouldUseMcpIconForAppIcon } from '@/utils/mcp'
import TabSlider from '@/app/components/base/tab-slider'
import { MCPAuthMethod } from '@/app/components/tools/types'
import Switch from '@/app/components/base/switch'

export type DuplicateAppModalProps = {
  data?: ToolWithProvider
  show: boolean
  onConfirm: (info: {
    name: string
    server_url: string
    icon_type: AppIconType
    icon: string
    icon_background?: string | null
    server_identifier: string
    headers?: Record<string, string>
    is_dynamic_registration?: boolean
    authentication?: {
      client_id?: string
      client_secret?: string
      grant_type?: string
    }
    configuration: {
      timeout: number
      sse_read_timeout: number
    }
  }) => void
  onHide: () => void
}

const DEFAULT_ICON = { type: 'emoji', icon: '🔗', background: '#6366F1' }
const extractFileId = (url: string) => {
  const match = url.match(/files\/(.+?)\/file-preview/)
  return match ? match[1] : null
}
const getIcon = (data?: ToolWithProvider) => {
  if (!data)
    return DEFAULT_ICON as AppIconSelection
  if (typeof data.icon === 'string')
    return { type: 'image', url: data.icon, fileId: extractFileId(data.icon) } as AppIconSelection
  return {
    ...data.icon,
    icon: data.icon.content,
    type: 'emoji',
  } as unknown as AppIconSelection
}

const MCPModal = ({
  data,
  show,
  onConfirm,
  onHide,
}: DuplicateAppModalProps) => {
  const { t } = useTranslation()
  const isCreate = !data

  const authMethods = [
    {
      text: t('tools.mcp.modal.authentication'),
      value: MCPAuthMethod.authentication,
    },
    {
      text: t('tools.mcp.modal.headers'),
      value: MCPAuthMethod.headers,
    },
    {
      text: t('tools.mcp.modal.configurations'),
      value: MCPAuthMethod.configurations,
    },
  ]
  const originalServerUrl = data?.server_url
  const originalServerID = data?.server_identifier
  const [url, setUrl] = React.useState(data?.server_url || '')
  const [name, setName] = React.useState(data?.name || '')
  const [appIcon, setAppIcon] = useState<AppIconSelection>(() => getIcon(data))
  const [showAppIconPicker, setShowAppIconPicker] = useState(false)
  const [serverIdentifier, setServerIdentifier] = React.useState(data?.server_identifier || '')
  const [timeout, setMcpTimeout] = React.useState(data?.timeout || 30)
  const [sseReadTimeout, setSseReadTimeout] = React.useState(data?.sse_read_timeout || 300)
  const [headers, setHeaders] = React.useState<HeaderItem[]>(
    Object.entries(data?.masked_headers || {}).map(([key, value]) => ({ id: uuid(), key, value })),
  )
  const [isFetchingIcon, setIsFetchingIcon] = useState(false)
  const appIconRef = useRef<HTMLDivElement>(null)
  const isHovering = useHover(appIconRef)
  const [authMethod, setAuthMethod] = useState(MCPAuthMethod.authentication)
  const [isDynamicRegistration, setIsDynamicRegistration] = useState(isCreate ? true : data?.is_dynamic_registration)
  const [clientID, setClientID] = useState(data?.authentication?.client_id || '')
  const [credentials, setCredentials] = useState(data?.authentication?.client_secret || '')

  // Update states when data changes (for edit mode)
  React.useEffect(() => {
    if (data) {
      setUrl(data.server_url || '')
      setName(data.name || '')
      setServerIdentifier(data.server_identifier || '')
      setMcpTimeout(data.timeout || 30)
      setSseReadTimeout(data.sse_read_timeout || 300)
      setHeaders(Object.entries(data.masked_headers || {}).map(([key, value]) => ({ id: uuid(), key, value })))
      setAppIcon(getIcon(data))
      setIsDynamicRegistration(data.is_dynamic_registration)
      setClientID(data.authentication?.client_id || '')
      setCredentials(data.authentication?.client_secret || '')
    }
    else {
      // Reset for create mode
      setUrl('')
      setName('')
      setServerIdentifier('')
      setMcpTimeout(30)
      setSseReadTimeout(300)
      setHeaders([])
      setAppIcon(DEFAULT_ICON as AppIconSelection)
      setIsDynamicRegistration(true)
      setClientID('')
      setCredentials('')
    }
  }, [data])

  const isValidUrl = (string: string) => {
    try {
      const url = new URL(string)
      return url.protocol === 'http:' || url.protocol === 'https:'
    }
    catch {
      return false
    }
  }

  const isValidServerID = (str: string) => {
    return /^[a-z0-9_-]{1,24}$/.test(str)
  }

  const handleBlur = async (url: string) => {
    if (data)
      return
    if (!isValidUrl(url))
      return
    const domain = getDomain(url)
    const remoteIcon = `https://www.google.com/s2/favicons?domain=${domain}&sz=128`
    setIsFetchingIcon(true)
    try {
      const res = await uploadRemoteFileInfo(remoteIcon, undefined, true)
      setAppIcon({ type: 'image', url: res.url, fileId: extractFileId(res.url) || '' })
    }
    catch (e) {
      let errorMessage = 'Failed to fetch remote icon'
      const errorData = await (e as Response).json()
      if (errorData?.code)
        errorMessage = `Upload failed: ${errorData.code}`
      console.error('Failed to fetch remote icon:', e)
      Toast.notify({ type: 'warning', message: errorMessage })
    }
    finally {
      setIsFetchingIcon(false)
    }
  }

  const submit = async () => {
    if (!isValidUrl(url)) {
      Toast.notify({ type: 'error', message: 'invalid server url' })
      return
    }
    if (!isValidServerID(serverIdentifier.trim())) {
      Toast.notify({ type: 'error', message: 'invalid server identifier' })
      return
    }
    const formattedHeaders = headers.reduce((acc, item) => {
      if (item.key.trim())
        acc[item.key.trim()] = item.value
      return acc
    }, {} as Record<string, string>)
    await onConfirm({
      server_url: originalServerUrl === url ? '[__HIDDEN__]' : url.trim(),
      name,
      icon_type: appIcon.type,
      icon: appIcon.type === 'emoji' ? appIcon.icon : appIcon.fileId,
      icon_background: appIcon.type === 'emoji' ? appIcon.background : undefined,
      server_identifier: serverIdentifier.trim(),
      headers: Object.keys(formattedHeaders).length > 0 ? formattedHeaders : undefined,
      is_dynamic_registration: isDynamicRegistration,
      authentication: {
        client_id: clientID,
        client_secret: credentials,
      },
      configuration: {
        timeout: timeout || 30,
        sse_read_timeout: sseReadTimeout || 300,
      },
    })
    if(isCreate)
      onHide()
  }

  const handleAuthMethodChange = useCallback((value: string) => {
    setAuthMethod(value as MCPAuthMethod)
  }, [])

  return (
    <>
      <Modal
        isShow={show}
        onClose={noop}
        className={cn('relative !max-w-[520px]', 'p-6')}
      >
        <div className='absolute right-5 top-5 z-10 cursor-pointer p-1.5' onClick={onHide}>
          <RiCloseLine className='h-5 w-5 text-text-tertiary' />
        </div>
        <div className='title-2xl-semi-bold relative pb-3 text-xl text-text-primary'>{!isCreate ? t('tools.mcp.modal.editTitle') : t('tools.mcp.modal.title')}</div>
        <div className='space-y-5 py-3'>
          <div>
            <div className='mb-1 flex h-6 items-center'>
              <span className='system-sm-medium text-text-secondary'>{t('tools.mcp.modal.serverUrl')}</span>
            </div>
            <Input
              value={url}
              onChange={e => setUrl(e.target.value)}
              onBlur={e => handleBlur(e.target.value.trim())}
              placeholder={t('tools.mcp.modal.serverUrlPlaceholder')}
            />
            {originalServerUrl && originalServerUrl !== url && (
              <div className='mt-1 flex h-5 items-center'>
                <span className='body-xs-regular text-text-warning'>{t('tools.mcp.modal.serverUrlWarning')}</span>
              </div>
            )}
          </div>
          <div className='flex space-x-3'>
            <div className='grow pb-1'>
              <div className='mb-1 flex h-6 items-center'>
                <span className='system-sm-medium text-text-secondary'>{t('tools.mcp.modal.name')}</span>
              </div>
              <Input
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder={t('tools.mcp.modal.namePlaceholder')}
              />
            </div>
            <div className='pt-2' ref={appIconRef}>
              <AppIcon
                iconType={appIcon.type}
                icon={appIcon.type === 'emoji' ? appIcon.icon : appIcon.fileId}
                background={appIcon.type === 'emoji' ? appIcon.background : undefined}
                imageUrl={appIcon.type === 'image' ? appIcon.url : undefined}
                innerIcon={shouldUseMcpIconForAppIcon(appIcon.type, appIcon.type === 'emoji' ? appIcon.icon : '') ? <Mcp className='h-8 w-8 text-text-primary-on-surface' /> : undefined}
                size='xxl'
                className='relative cursor-pointer rounded-2xl'
                coverElement={
                  isHovering
                    ? (<div className='absolute inset-0 flex items-center justify-center overflow-hidden rounded-2xl bg-background-overlay-alt'>
                      <RiEditLine className='size-6 text-text-primary-on-surface' />
                    </div>) : null
                }
                onClick={() => { setShowAppIconPicker(true) }}
              />
            </div>
          </div>
          <div>
            <div className='flex h-6 items-center'>
              <span className='system-sm-medium text-text-secondary'>{t('tools.mcp.modal.serverIdentifier')}</span>
            </div>
            <div className='body-xs-regular mb-1 text-text-tertiary'>{t('tools.mcp.modal.serverIdentifierTip')}</div>
            <Input
              value={serverIdentifier}
              onChange={e => setServerIdentifier(e.target.value)}
              placeholder={t('tools.mcp.modal.serverIdentifierPlaceholder')}
            />
            {originalServerID && originalServerID !== serverIdentifier && (
              <div className='mt-1 flex h-5 items-center'>
                <span className='body-xs-regular text-text-warning'>{t('tools.mcp.modal.serverIdentifierWarning')}</span>
              </div>
            )}
          </div>
          <TabSlider
            className='w-full'
            itemClassName={(isActive) => {
              return `flex-1 ${isActive && 'text-text-accent-light-mode-only'}`
            }}
            value={authMethod}
            onChange={handleAuthMethodChange}
            options={authMethods}
          />
          {
            authMethod === MCPAuthMethod.authentication && (
              <>
                <div>
                  <div className='mb-1 flex h-6 items-center'>
                    <Switch
                      className='mr-2'
                      defaultValue={isDynamicRegistration}
                      onChange={setIsDynamicRegistration}
                    />
                    <span className='system-sm-medium text-text-secondary'>{t('tools.mcp.modal.useDynamicClientRegistration')}</span>
                  </div>
                </div>
                <div>
                  <div className={cn('mb-1 flex h-6 items-center', isDynamicRegistration && 'opacity-50')}>
                    <span className='system-sm-medium text-text-secondary'>{t('tools.mcp.modal.clientID')}</span>
                  </div>
                  <Input
                    value={clientID}
                    onChange={e => setClientID(e.target.value)}
                    onBlur={e => handleBlur(e.target.value.trim())}
                    placeholder={t('tools.mcp.modal.clientID')}
                    disabled={isDynamicRegistration}
                  />
                </div>
                <div>
                  <div className={cn('mb-1 flex h-6 items-center', isDynamicRegistration && 'opacity-50')}>
                    <span className='system-sm-medium text-text-secondary'>{t('tools.mcp.modal.clientSecret')}</span>
                  </div>
                  <Input
                    value={credentials}
                    onChange={e => setCredentials(e.target.value)}
                    onBlur={e => handleBlur(e.target.value.trim())}
                    placeholder={t('tools.mcp.modal.clientSecretPlaceholder')}
                    disabled={isDynamicRegistration}
                  />
                </div>
              </>
            )
          }
          {
            authMethod === MCPAuthMethod.headers && (
              <div>
                <div className='mb-1 flex h-6 items-center'>
                  <span className='system-sm-medium text-text-secondary'>{t('tools.mcp.modal.headers')}</span>
                </div>
                <div className='body-xs-regular mb-2 text-text-tertiary'>{t('tools.mcp.modal.headersTip')}</div>
                <HeadersInput
                  headersItems={headers}
                  onChange={setHeaders}
                  readonly={false}
                  isMasked={!isCreate && headers.filter(item => item.key.trim()).length > 0}
                />
              </div>
            )
          }
          {
            authMethod === MCPAuthMethod.configurations && (
              <>
                <div>
                  <div className='mb-1 flex h-6 items-center'>
                    <span className='system-sm-medium text-text-secondary'>{t('tools.mcp.modal.timeout')}</span>
                  </div>
                  <Input
                    type='number'
                    value={timeout}
                    onChange={e => setMcpTimeout(Number(e.target.value))}
                    onBlur={e => handleBlur(e.target.value.trim())}
                    placeholder={t('tools.mcp.modal.timeoutPlaceholder')}
                  />
                </div>
                <div>
                  <div className='mb-1 flex h-6 items-center'>
                    <span className='system-sm-medium text-text-secondary'>{t('tools.mcp.modal.sseReadTimeout')}</span>
                  </div>
                  <Input
                    type='number'
                    value={sseReadTimeout}
                    onChange={e => setSseReadTimeout(Number(e.target.value))}
                    onBlur={e => handleBlur(e.target.value.trim())}
                    placeholder={t('tools.mcp.modal.timeoutPlaceholder')}
                  />
                </div>
              </>
            )
          }
        </div>
        <div className='flex flex-row-reverse pt-5'>
          <Button disabled={!name || !url || !serverIdentifier || isFetchingIcon} className='ml-2' variant='primary' onClick={submit}>{data ? t('tools.mcp.modal.save') : t('tools.mcp.modal.confirm')}</Button>
          <Button onClick={onHide}>{t('tools.mcp.modal.cancel')}</Button>
        </div>
      </Modal>
      {showAppIconPicker && <AppIconPicker
        onSelect={(payload) => {
          setAppIcon(payload)
          setShowAppIconPicker(false)
        }}
        onClose={() => {
          setAppIcon(getIcon(data))
          setShowAppIconPicker(false)
        }}
      />}
    </>

  )
}

export default MCPModal
