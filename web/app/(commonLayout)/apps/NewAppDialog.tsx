'use client'

import type { MouseEventHandler } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import useSWR from 'swr'
import classNames from 'classnames'
import { useRouter } from 'next/navigation'
import { useContext, useContextSelector } from 'use-context-selector'
import { useTranslation } from 'react-i18next'
import style from '../list.module.css'
import AppModeLabel from './AppModeLabel'
import Button from '@/app/components/base/button'
import Dialog from '@/app/components/base/dialog'
import type { AppMode } from '@/types/app'
import { ToastContext } from '@/app/components/base/toast'
import { createApp, fetchAppTemplates } from '@/service/apps'
import AppIcon from '@/app/components/base/app-icon'
import AppsContext from '@/context/app-context'

import EmojiPicker from '@/app/components/base/emoji-picker'

type NewAppDialogProps = {
  show: boolean
  onSuccess?: () => void
  onClose?: () => void
}

const NewAppDialog = ({ show, onSuccess, onClose }: NewAppDialogProps) => {
  const router = useRouter()
  const { notify } = useContext(ToastContext)
  const { t } = useTranslation()

  const nameInputRef = useRef<HTMLInputElement>(null)
  const [newAppMode, setNewAppMode] = useState<AppMode>()
  const [isWithTemplate, setIsWithTemplate] = useState(false)
  const [selectedTemplateIndex, setSelectedTemplateIndex] = useState<number>(-1)

  // Emoji Picker
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
  const [emoji, setEmoji] = useState({ icon: '🤖', icon_background: '#FFEAD5' })

  const mutateApps = useContextSelector(AppsContext, state => state.mutateApps)

  const { data: templates, mutate } = useSWR({ url: '/app-templates' }, fetchAppTemplates)
  const mutateTemplates = useCallback(
    () => mutate(),
    [],
  )

  useEffect(() => {
    if (show) {
      mutateTemplates()
      setIsWithTemplate(false)
    }
  }, [show])

  const isCreatingRef = useRef(false)
  const onCreate: MouseEventHandler = useCallback(async () => {
    const name = nameInputRef.current?.value
    if (!name) {
      notify({ type: 'error', message: t('app.newApp.nameNotEmpty') })
      return
    }
    if (!templates || (isWithTemplate && !(selectedTemplateIndex > -1))) {
      notify({ type: 'error', message: t('app.newApp.appTemplateNotSelected') })
      return
    }
    if (!isWithTemplate && !newAppMode) {
      notify({ type: 'error', message: t('app.newApp.appTypeRequired') })
      return
    }
    if (isCreatingRef.current)
      return
    isCreatingRef.current = true
    try {
      const app = await createApp({
        name,
        icon: emoji.icon,
        icon_background: emoji.icon_background,
        mode: isWithTemplate ? templates.data[selectedTemplateIndex].mode : newAppMode!,
        config: isWithTemplate ? templates.data[selectedTemplateIndex].model_config : undefined,
      })
      if (onSuccess)
        onSuccess()
      if (onClose)
        onClose()
      notify({ type: 'success', message: t('app.newApp.appCreated') })
      mutateApps()
      router.push(`/app/${app.id}/overview`)
    }
    catch (e) {
      notify({ type: 'error', message: t('app.newApp.appCreateFailed') })
    }
    isCreatingRef.current = false
  }, [isWithTemplate, newAppMode, notify, router, templates, selectedTemplateIndex, emoji])

  return <>
    {showEmojiPicker && <EmojiPicker
      onSelect={(icon, icon_background) => {
        console.log(icon, icon_background)
        setEmoji({ icon, icon_background })
        setShowEmojiPicker(false)
      }}
      onClose={() => {
        setEmoji({ icon: '🤖', icon_background: '#FFEAD5' })
        setShowEmojiPicker(false)
      }}
    />}
    <Dialog
      show={show}
      title={t('app.newApp.startToCreate')}
      footer={
        <>
          <Button onClick={onClose}>{t('app.newApp.Cancel')}</Button>
          <Button type="primary" onClick={onCreate}>{t('app.newApp.Create')}</Button>
        </>
      }
    >
      <h3 className={style.newItemCaption}>{t('app.newApp.captionName')}</h3>

      <div className='flex items-center justify-between gap-3 mb-8'>
        <AppIcon size='large' onClick={() => { setShowEmojiPicker(true) }} className='cursor-pointer' icon={emoji.icon} background={emoji.icon_background} />
        <input ref={nameInputRef} className='h-10 px-3 text-sm font-normal bg-gray-100 rounded-lg grow' />
      </div>

      <div className='h-[247px]'>
        <div className={style.newItemCaption}>
          <h3 className='inline'>{t('app.newApp.captionAppType')}</h3>
          {isWithTemplate && (
            <>
              <span className='block ml-[9px] mr-[9px] w-[1px] h-[13px] bg-gray-200' />
              <span
                className='inline-flex items-center gap-1 text-xs font-medium cursor-pointer text-primary-600'
                onClick={() => setIsWithTemplate(false)}
              >
                {t('app.newApp.hideTemplates')}
              </span>
            </>
          )}
        </div>
        {isWithTemplate
          ? (
            <ul className='grid grid-cols-2 gap-4'>
              {templates?.data?.map((template, index) => (
                <li
                  key={index}
                  className={classNames(style.listItem, style.selectable, selectedTemplateIndex === index && style.selected)}
                  onClick={() => setSelectedTemplateIndex(index)}
                >
                  <div className={style.listItemTitle}>
                    <AppIcon size='small' />
                    <div className={style.listItemHeading}>
                      <div className={style.listItemHeadingContent}>{template.name}</div>
                    </div>
                  </div>
                  <div className={style.listItemDescription}>{template.model_config?.pre_prompt}</div>
                  <AppModeLabel mode={template.mode} className='mt-2' />
                  {/* <AppModeLabel mode='chat' className='mt-2' /> */}
                </li>
              ))}
            </ul>
          )
          : (
            <>
              <ul className='grid grid-cols-2 gap-4'>
                <li
                  className={classNames(style.listItem, style.selectable, newAppMode === 'chat' && style.selected)}
                  onClick={() => setNewAppMode('chat')}
                >
                  <div className={style.listItemTitle}>
                    <span className={style.newItemIcon}>
                      <span className={classNames(style.newItemIconImage, style.newItemIconChat)} />
                    </span>
                    <div className={style.listItemHeading}>
                      <div className={style.listItemHeadingContent}>{t('app.newApp.chatApp')}</div>
                    </div>
                  </div>
                  <div className={style.listItemDescription}>{t('app.newApp.chatAppIntro')}</div>
                  <div className={classNames(style.listItemFooter, 'justify-end')}>
                    <a className={style.listItemLink} href='https://udify.app/chat/7CQBa5yyvYLSkZtx' target='_blank'>{t('app.newApp.previewDemo')}<span className={classNames(style.linkIcon, style.grayLinkIcon)} /></a>
                  </div>
                </li>
                <li
                  className={classNames(style.listItem, style.selectable, newAppMode === 'completion' && style.selected)}
                  onClick={() => setNewAppMode('completion')}
                >
                  <div className={style.listItemTitle}>
                    <span className={style.newItemIcon}>
                      <span className={classNames(style.newItemIconImage, style.newItemIconComplete)} />
                    </span>
                    <div className={style.listItemHeading}>
                      <div className={style.listItemHeadingContent}>{t('app.newApp.completeApp')}</div>
                    </div>
                  </div>
                  <div className={style.listItemDescription}>{t('app.newApp.completeAppIntro')}</div>
                  <div className={classNames(style.listItemFooter, 'justify-end')}>
                    <a className={style.listItemLink} href='https://udify.app/completion/aeFTj0VCb3Ok3TUE' target='_blank'>{t('app.newApp.previewDemo')}<span className={classNames(style.linkIcon, style.grayLinkIcon)} /></a>
                  </div>
                </li>
              </ul>
              <div className='flex items-center h-[34px] mt-2'>
                <span
                  className='inline-flex items-center gap-1 text-xs font-medium cursor-pointer text-primary-600'
                  onClick={() => setIsWithTemplate(true)}
                >
                  {t('app.newApp.showTemplates')}<span className={style.rightIcon} />
                </span>
              </div>
            </>
          )}
      </div>
    </Dialog>
  </>
}

export default NewAppDialog
