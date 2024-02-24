'use client'

import type { MouseEventHandler } from 'react'
import { useCallback, useRef, useState } from 'react'
import cn from 'classnames'
import { useTranslation } from 'react-i18next'
import { useRouter } from 'next/navigation'
import { useContext, useContextSelector } from 'use-context-selector'
import { useProviderContext } from '@/context/provider-context'
import { ToastContext } from '@/app/components/base/toast'
import AppsContext, { useAppContext } from '@/context/app-context'
import type { AppMode } from '@/types/app'
import { createApp } from '@/service/apps'
import Button from '@/app/components/base/button'
import AppIcon from '@/app/components/base/app-icon'
import EmojiPicker from '@/app/components/base/emoji-picker'
import AppsFull from '@/app/components/billing/apps-full-in-dialog'
import { BubbleText } from '@/app/components/base/icons/src/vender/solid/education'
import { CuteRobote } from '@/app/components/base/icons/src/vender/solid/communication'
import { Route } from '@/app/components/base/icons/src/vender/line/mapsAndTravel'

export type AppFormProps = {
  onConfirm: () => void
  onHide: () => void
}

const AppForm = ({
  onConfirm,
  onHide,
}: AppFormProps) => {
  const { t } = useTranslation()
  const router = useRouter()
  const { notify } = useContext(ToastContext)

  const mutateApps = useContextSelector(AppsContext, state => state.mutateApps)

  const [appMode, setAppMode] = useState<AppMode>('chat')
  const [emoji, setEmoji] = useState({ icon: '🤖', icon_background: '#FFEAD5' })
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')

  const { plan, enableBilling } = useProviderContext()
  const isAppsFull = (enableBilling && plan.usage.buildApps >= plan.total.buildApps)
  const { isCurrentWorkspaceManager } = useAppContext()

  const isCreatingRef = useRef(false)
  const onCreate: MouseEventHandler = useCallback(async () => {
    if (!name.trim()) {
      notify({ type: 'error', message: t('app.newApp.nameNotEmpty') })
      return
    }
    if (isCreatingRef.current)
      return
    isCreatingRef.current = true
    try {
      const app = await createApp({
        mode: appMode,
        name,
        icon: emoji.icon,
        icon_background: emoji.icon_background,
        description,
      })
      notify({ type: 'success', message: t('app.newApp.appCreated') })
      onConfirm()
      onHide()
      mutateApps()
      router.push(`/app/${app.id}/${isCurrentWorkspaceManager ? 'configuration' : 'overview'}`)
    }
    catch (e) {
      notify({ type: 'error', message: t('app.newApp.appCreateFailed') })
    }
    isCreatingRef.current = false
  }, [name, notify, t, appMode, emoji.icon, emoji.icon_background, description, onConfirm, onHide, mutateApps, router, isCurrentWorkspaceManager])

  return (
    <>
      {/* app type */}
      <div className='pt-2 px-8'>
        <div className='py-2 text-sm leading-[20px] font-medium text-gray-900'>{t('app.newApp.captionAppType')}</div>
        <div>
          <div
            className={cn(
              'relative mb-2 p-3 pl-[56px] min-h-[84px] bg-gray-25 rounded-xl border-[1.5px] border-gray-100 cursor-pointer hover:border-[#d1e0ff]',
              appMode === 'chat' && 'border-primary-400 hover:border-primary-400',
            )}
            onClick={() => setAppMode('chat')}
          >
            <div className='absolute top-3 left-3 w-8 h-8 p-2 bg-indigo-50 rounded-lg'>
              <BubbleText className='w-4 h-4 text-indigo-600'/>
            </div>
            <div className='mb-1 text-sm leading-[20px] font-semibold text-gray-800'>{t('app.types.chatbot')}</div>
            <div className='text-xs leading-[18px] text-gray-500'>{t('app.newApp.chatbotDescription')}</div>
          </div>
          <div
            className={cn(
              'relative mb-2 p-3 pl-[56px] min-h-[84px] bg-gray-25 rounded-xl border-[1.5px] border-gray-100 cursor-pointer hover:border-[#d1e0ff]',
              appMode === 'agent' && 'border-primary-400 hover:border-primary-400',
            )}
            onClick={() => setAppMode('agent')}
          >
            <div className='absolute top-3 left-3 w-8 h-8 p-2 bg-indigo-50 rounded-lg'>
              <CuteRobote className='w-4 h-4 text-indigo-600'/>
            </div>
            <div className='mb-1 text-sm leading-[20px] font-semibold text-gray-800'>{t('app.types.agent')}</div>
            <div className='text-xs leading-[18px] text-gray-500'>{t('app.newApp.agentDescription')}</div>
          </div>
          <div
            className={cn(
              'relative mb-2 p-3 pl-[56px] min-h-[84px] bg-gray-25 rounded-xl border-[1.5px] border-gray-100 cursor-pointer hover:border-[#d1e0ff]',
              appMode === 'workflow' && 'border-primary-400 hover:border-primary-400',
            )}
            onClick={() => setAppMode('workflow')}
          >
            <div className='absolute top-3 left-3 w-8 h-8 p-2 bg-indigo-50 rounded-lg'>
              <Route className='w-4 h-4 text-indigo-600'/>
            </div>
            <div className='mb-1 text-sm leading-[20px] font-semibold text-gray-800'>{t('app.types.workflow')}</div>
            <div className='text-xs leading-[18px] text-gray-500'>{t('app.newApp.workflowDescription')}</div>
          </div>
        </div>
      </div>
      {/* icon & name */}
      <div className='pt-2 px-8'>
        <div className='py-2 text-sm font-medium leading-[20px] text-gray-900'>{t('app.newApp.captionName')}</div>
        <div className='flex items-center justify-between space-x-3'>
          <AppIcon size='large' onClick={() => { setShowEmojiPicker(true) }} className='cursor-pointer' icon={emoji.icon} background={emoji.icon_background} />
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder={t('app.newApp.appNamePlaceholder') || ''}
            className='grow h-10 px-3 text-sm font-normal bg-gray-100 rounded-lg border border-transparent outline-none appearance-none caret-primary-600 placeholder:text-gray-400 hover:bg-gray-50 hover:border hover:border-gray-300 focus:bg-gray-50 focus:border focus:border-gray-300 focus:shadow-xs'
          />
        </div>
        {showEmojiPicker && <EmojiPicker
          onSelect={(icon, icon_background) => {
            setEmoji({ icon, icon_background })
            setShowEmojiPicker(false)
          }}
          onClose={() => {
            setEmoji({ icon: '🤖', icon_background: '#FFEAD5' })
            setShowEmojiPicker(false)
          }}
        />}
      </div>
      {/* description */}
      <div className='pt-2 px-8'>
        <div className='py-2 text-sm font-medium leading-[20px] text-gray-900'>{t('app.newApp.captionDescription')}</div>
        <textarea
          className='w-full h-10 px-3 py-2 text-sm font-normal bg-gray-100 rounded-lg border border-transparent outline-none appearance-none caret-primary-600 placeholder:text-gray-400 hover:bg-gray-50 hover:border hover:border-gray-300 focus:bg-gray-50 focus:border focus:border-gray-300 focus:shadow-xs h-[80px] resize-none'
          placeholder={t('app.newApp.appDescriptionPlaceholder') || ''}
          value={description}
          onChange={e => setDescription(e.target.value)}
        />
      </div>
      {isAppsFull && (
        <div className='px-8 py-2'>
          <AppsFull loc='app-create' />
        </div>
      )}
      <div className='px-8 py-6 flex justify-end'>
        <Button className='mr-2 text-gray-700 text-sm font-medium' onClick={onHide}>{t('app.newApp.Cancel')}</Button>
        <Button className='text-sm font-medium' disabled={isAppsFull || !name} type="primary" onClick={onCreate}>{t('app.newApp.Create')}</Button>
      </div>
    </>

  )
}

export default AppForm
