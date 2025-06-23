'use client'
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RiCloseLine } from '@remixicon/react'
import AppIconPicker from '@/app/components/base/app-icon-picker'
import type { AppIconSelection } from '@/app/components/base/app-icon-picker'
import AppIcon from '@/app/components/base/app-icon'
import Modal from '@/app/components/base/modal'
import Button from '@/app/components/base/button'
import Input from '@/app/components/base/input'
import type { AppIconType } from '@/types/app'
import type { ToolWithProvider } from '@/app/components/workflow/types'
import { noop } from 'lodash-es'
import Toast from '@/app/components/base/toast'
import cn from '@/utils/classnames'

export type DuplicateAppModalProps = {
  data?: ToolWithProvider
  show: boolean
  onConfirm: (info: {
    name: string
    server_url: string
    icon_type: AppIconType
    icon: string
    icon_background?: string | null
  }) => void
  onHide: () => void
}

const DEFAULT_ICON = { type: 'emoji', icon: '🧿', background: '#EFF1F5' }
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

  const originalServerUrl = data?.server_url
  const [name, setName] = React.useState(data?.name || '')
  const [appIcon, setAppIcon] = useState<AppIconSelection>(getIcon(data))
  const [url, setUrl] = React.useState(data?.server_url || '')
  const [showAppIconPicker, setShowAppIconPicker] = useState(false)

  const isValidUrl = (string: string) => {
    try {
      const urlPattern = /^(https?:\/\/)((([a-z\d]([a-z\d-]*[a-z\d])*)\.)+[a-z]{2,}|((\d{1,3}\.){3}\d{1,3}))(\:\d+)?(\/[-a-z\d%_.~+]*)*(\?[;&a-z\d%_.~+=-]*)?/i
      return urlPattern.test(string)
    }
    catch (e) {
      return false
    }
  }

  const submit = async () => {
    if (!isValidUrl(url)) {
      Toast.notify({ type: 'error', message: 'invalid server url' })
      return
    }
    await onConfirm({
      name,
      server_url: originalServerUrl === url ? '[__HIDDEN__]' : url,
      icon_type: appIcon.type,
      icon: appIcon.type === 'emoji' ? appIcon.icon : appIcon.fileId,
      icon_background: appIcon.type === 'emoji' ? appIcon.background : undefined,
    })
    onHide()
  }

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
        <div className='title-2xl-semi-bold relative pb-3 text-xl text-text-primary'>{data ? t('tools.mcp.modal.editTitle') : t('tools.mcp.modal.title')}</div>
        <div className='space-y-5 py-3'>
          <div>
            <div className='mb-1 flex h-6 items-center'>
              <span className='system-sm-medium text-text-secondary'>{t('tools.mcp.modal.serverUrl')}</span>
            </div>
            <Input
              value={url}
              onChange={e => setUrl(e.target.value)}
              placeholder={t('tools.mcp.modal.serverUrlPlaceholder')}
            />
            {originalServerUrl && originalServerUrl !== url && (
              <div className='mt-1 flex h-5 items-center'>
                <span className='body-xs-regular text-text-warning'>{t('tools.mcp.modal.warning')}</span>
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
            <div className='pt-2'>
              <AppIcon
                iconType={appIcon.type}
                icon={appIcon.type === 'emoji' ? appIcon.icon : appIcon.fileId}
                background={appIcon.type === 'emoji' ? appIcon.background : undefined}
                imageUrl={appIcon.type === 'image' ? appIcon.url : undefined}
                size='xxl' className='cursor-pointer rounded-2xl'
                onClick={() => { setShowAppIconPicker(true) }}
              />
            </div>
          </div>
        </div>
        <div className='flex flex-row-reverse pt-5'>
          <Button disabled={!name || !url} className='ml-2' variant='primary' onClick={submit}>{data ? t('tools.mcp.modal.save') : t('tools.mcp.modal.confirm')}</Button>
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
