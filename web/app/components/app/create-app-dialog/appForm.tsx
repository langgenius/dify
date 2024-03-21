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
import { AiText, ChatBot, CuteRobot } from '@/app/components/base/icons/src/vender/line/communication'
import { HelpCircle } from '@/app/components/base/icons/src/vender/line/general'
import { Route } from '@/app/components/base/icons/src/vender/line/mapsAndTravel'
import TooltipPlus from '@/app/components/base/tooltip-plus'
import { getRedirection } from '@/utils/app-redirection'

export type AppFormProps = {
  onConfirm: () => void
  onHide: () => void
  onTipChange: (tip: string) => void
}

const AppForm = ({
  onConfirm,
  onHide,
  onTipChange,
}: AppFormProps) => {
  const { t } = useTranslation()
  const { push } = useRouter()
  const { notify } = useContext(ToastContext)

  const mutateApps = useContextSelector(AppsContext, state => state.mutateApps)

  const [appMode, setAppMode] = useState<AppMode>()
  const [showChatBotType, setShowChatBotType] = useState<boolean>(false)
  const [emoji, setEmoji] = useState({ icon: '🤖', icon_background: '#FFEAD5' })
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')

  const { plan, enableBilling } = useProviderContext()
  const isAppsFull = (enableBilling && plan.usage.buildApps >= plan.total.buildApps)
  const { isCurrentWorkspaceManager } = useAppContext()

  const isCreatingRef = useRef(false)
  const onCreate: MouseEventHandler = useCallback(async () => {
    if (!appMode) {
      notify({ type: 'error', message: t('app.newApp.appTypeRequired') })
      return
    }
    if (!name.trim()) {
      notify({ type: 'error', message: t('app.newApp.nameNotEmpty') })
      return
    }
    if (isCreatingRef.current)
      return
    isCreatingRef.current = true
    try {
      const app = await createApp({
        name,
        description,
        icon: emoji.icon,
        icon_background: emoji.icon_background,
        mode: appMode,
      })
      notify({ type: 'success', message: t('app.newApp.appCreated') })
      onConfirm()
      onHide()
      mutateApps()
      getRedirection(isCurrentWorkspaceManager, app, push)
    }
    catch (e) {
      notify({ type: 'error', message: t('app.newApp.appCreateFailed') })
    }
    isCreatingRef.current = false
  }, [name, notify, t, appMode, emoji.icon, emoji.icon_background, description, onConfirm, onHide, mutateApps, push, isCurrentWorkspaceManager])

  return (
    <div className='overflow-y-auto'>
      {/* app type */}
      <div className='py-2 px-8 w-[520px]'>
        <div className='py-2 text-sm leading-[20px] font-medium text-gray-900'>{t('app.newApp.captionAppType')}</div>
        <div className='flex justify-between'>
          <TooltipPlus
            hideArrow
            popupContent={
              <div className='max-w-[280px] leading-[18px] text-xs text-gray-700'>{t('app.newApp.chatbotDescription')}</div>
            }
          >
            <div
              className={cn(
                'relative grow w-[108px] mr-2 px-0.5 pt-3 pb-2 flex flex-col items-center justify-center gap-1 rounded-lg border border-gray-100 bg-gray-25 text-gray-700 cursor-pointer hover:bg-white hover:shadow-xs hover:border-gray-300',
                showChatBotType && 'bg-white shadow-xs border-[1.5px] border-primary-400 hover:border-[1.5px] hover:border-primary-400',
              )}
              onClick={() => {
                setAppMode('chat')
                setShowChatBotType(true)
              }}
            >
              <ChatBot className='w-6 h-6' />
              <div className='h-5 text-[13px] font-medium leading-[18px]'>{t('app.types.chatbot')}</div>
              <div className='hidden absolute max-h-[92px] left-[-20px] bottom-[75px] px-3 py-[10px] bg-white rounded-xl shadow-lg border-[0.5px] border-[rgba(0,0,0,0.05)] text-gray-700 text-xs leading-[18px] group-hover:block'>{t('app.newApp.chatbotDescription')}</div>
            </div>
          </TooltipPlus>
          <TooltipPlus
            hideArrow
            popupContent={
              <div className='flex flex-col max-w-[320px] leading-[18px] text-xs'>
                <div className='text-gray-700'>{t('app.newApp.completionDescription')}</div>
              </div>
            }
          >
            <div
              className={cn(
                'relative grow w-[108px] mr-2 px-0.5 pt-3 pb-2 flex flex-col items-center justify-center gap-1 rounded-lg border border-gray-100 bg-gray-25 text-gray-700 cursor-pointer hover:bg-white hover:shadow-xs hover:border-gray-300',
                appMode === 'completion' && 'bg-white shadow-xs border-[1.5px] border-primary-400 hover:border-[1.5px] hover:border-primary-400',
              )}
              onClick={() => {
                setAppMode('completion')
                setShowChatBotType(false)
              }}
            >
              <AiText className='w-6 h-6' />
              <div className='h-5 text-[13px] font-medium leading-[18px]'>{t('app.newApp.completeApp')}</div>
            </div>
          </TooltipPlus>
          <TooltipPlus
            hideArrow
            popupContent={
              <div className='max-w-[280px] leading-[18px] text-xs text-gray-700'>{t('app.newApp.agentDescription')}</div>
            }
          >
            <div
              className={cn(
                'relative grow w-[108px] mr-2 px-0.5 pt-3 pb-2 flex flex-col items-center justify-center gap-1 rounded-lg border border-gray-100 bg-gray-25 text-gray-700 cursor-pointer hover:bg-white hover:shadow-xs hover:border-gray-300',
                appMode === 'agent-chat' && 'bg-white shadow-xs border-[1.5px] border-primary-400 hover:border-[1.5px] hover:border-primary-400',
              )}
              onClick={() => {
                setAppMode('agent-chat')
                setShowChatBotType(false)
              }}
            >
              <CuteRobot className='w-6 h-6' />
              <div className='h-5 text-[13px] font-medium leading-[18px]'>{t('app.types.agent')}</div>
            </div>
          </TooltipPlus>
          <TooltipPlus
            hideArrow
            popupContent={
              <div className='flex flex-col max-w-[320px] leading-[18px] text-xs'>
                <div className='text-gray-700'>{t('app.newApp.workflowDescription')}</div>
              </div>
            }
          >
            <div
              className={cn(
                'relative grow w-[108px] px-0.5 pt-3 pb-2 flex flex-col items-center justify-center gap-1 rounded-lg border border-gray-100 bg-gray-25 text-gray-700 cursor-pointer hover:bg-white hover:shadow-xs hover:border-gray-300',
                appMode === 'workflow' && 'bg-white shadow-xs border-[1.5px] border-primary-400 hover:border-[1.5px] hover:border-primary-400',
              )}
              onClick={() => {
                setAppMode('workflow')
                setShowChatBotType(false)
              }}
            >
              <Route className='w-6 h-6' />
              <div className='h-5 text-[13px] font-medium leading-[18px]'>{t('app.types.workflow')}</div>
              <span className='absolute top-[-3px] right-[-3px] px-1 rounded-[5px] bg-white border border-black/8 text-gray-500 text-[10px] leading-[18px] font-medium'>BETA</span>
            </div>
          </TooltipPlus>
        </div>
      </div>
      {showChatBotType && (
        <div className='py-2 px-8'>
          <div className='py-2 text-sm leading-[20px] font-medium text-gray-900'>{t('app.newApp.chatbotType')}</div>
          <div className='flex gap-2'>
            <div
              className={cn(
                'relative grow flex-[50%] pl-3 py-2 pr-2 flex justify-between  items-center rounded-lg border border-gray-100 bg-gray-25 text-gray-700 cursor-pointer hover:bg-white hover:shadow-xs hover:border-gray-300',
                appMode === 'chat' && 'bg-white shadow-xs border-[1.5px] border-primary-400 hover:border-[1.5px] hover:border-primary-400',
              )}
              onClick={() => {
                setAppMode('chat')
              }}
            >
              <div className='h-5 text-sm font-medium leading-5'>{t('app.newApp.basic')}</div>
              <div
                onMouseEnter={() => onTipChange('BASIC')}
                onMouseLeave={() => onTipChange('')}
              >
                <HelpCircle className='w-[14px] h-[14px] text-gray-400 hover:text-gray-500' />
              </div>
            </div>
            <div
              className={cn(
                'relative grow flex-[50%] pl-3 py-2 pr-2 flex justify-between items-center rounded-lg border border-gray-100 bg-gray-25 text-gray-700 cursor-pointer hover:bg-white hover:shadow-xs hover:border-gray-300',
                appMode === 'advanced-chat' && 'bg-white shadow-xs border-[1.5px] border-primary-400 hover:border-[1.5px] hover:border-primary-400',
              )}
              onClick={() => {
                setAppMode('advanced-chat')
              }}
            >
              <div className='h-5 text-sm font-medium leading-5'>{t('app.newApp.advanced')}</div>
              <div
                onMouseEnter={() => onTipChange('ADVANCED')}
                onMouseLeave={() => onTipChange('')}
              >
                <HelpCircle className='w-[14px] h-[14px] text-gray-400 hover:text-gray-500' />
              </div>
              <span className='absolute top-[-11px] left-[8px] px-1 rounded-[5px] bg-white border border-black/8 text-gray-500 text-[10px] leading-[18px] font-medium'>BETA</span>
            </div>
          </div>
        </div>
      )}
      {/* icon & name */}
      <div className='pt-2 px-8'>
        <div className='py-2 text-sm font-medium leading-[20px] text-gray-900'>{t('app.newApp.captionName')}</div>
        <div className='flex items-center justify-between space-x-2'>
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
    </div>

  )
}

export default AppForm
