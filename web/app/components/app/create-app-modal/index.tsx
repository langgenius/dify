'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useRouter } from 'next/navigation'
import { useContext } from 'use-context-selector'
import { RiArrowRightLine, RiArrowRightSLine, RiCommandLine, RiCornerDownLeftLine, RiExchange2Fill } from '@remixicon/react'
import Link from 'next/link'
import { useDebounceFn, useKeyPress } from 'ahooks'
import Image from 'next/image'
import AppIconPicker from '../../base/app-icon-picker'
import type { AppIconSelection } from '../../base/app-icon-picker'
import Button from '@/app/components/base/button'
import Divider from '@/app/components/base/divider'
import cn from '@/utils/classnames'
import { basePath } from '@/utils/var'
import { useAppContext } from '@/context/app-context'
import { useProviderContext } from '@/context/provider-context'
import { ToastContext } from '@/app/components/base/toast'
import type { AppMode } from '@/types/app'
import { createApp } from '@/service/apps'
import Input from '@/app/components/base/input'
import Textarea from '@/app/components/base/textarea'
import AppIcon from '@/app/components/base/app-icon'
import AppsFull from '@/app/components/billing/apps-full-in-dialog'
import { BubbleTextMod, ChatBot, ListSparkle, Logic } from '@/app/components/base/icons/src/vender/solid/communication'
import { NEED_REFRESH_APP_LIST_KEY } from '@/config'
import { getRedirection } from '@/utils/app-redirection'
import FullScreenModal from '@/app/components/base/fullscreen-modal'
import useTheme from '@/hooks/use-theme'
import { useDocLink } from '@/context/i18n'

type CreateAppProps = {
  onSuccess: () => void
  onClose: () => void
  onCreateFromTemplate?: () => void
  defaultAppMode?: AppMode
}

function CreateApp({ onClose, onSuccess, onCreateFromTemplate, defaultAppMode }: CreateAppProps) {
  const { t } = useTranslation()
  const { push } = useRouter()
  const { notify } = useContext(ToastContext)

  const [appMode, setAppMode] = useState<AppMode>(defaultAppMode || 'advanced-chat')
  const [appIcon, setAppIcon] = useState<AppIconSelection>({ type: 'emoji', icon: '🤖', background: '#FFEAD5' })
  const [showAppIconPicker, setShowAppIconPicker] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [isAppTypeExpanded, setIsAppTypeExpanded] = useState(false)

  const { plan, enableBilling } = useProviderContext()
  const isAppsFull = (enableBilling && plan.usage.buildApps >= plan.total.buildApps)
  const { isCurrentWorkspaceEditor } = useAppContext()

  const isCreatingRef = useRef(false)

  useEffect(() => {
    if (appMode === 'chat' || appMode === 'agent-chat' || appMode === 'completion')
      setIsAppTypeExpanded(true)
  }, [appMode])

  const onCreate = useCallback(async () => {
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
        icon_type: appIcon.type,
        icon: appIcon.type === 'emoji' ? appIcon.icon : appIcon.fileId,
        icon_background: appIcon.type === 'emoji' ? appIcon.background : undefined,
        mode: appMode,
      })
      notify({ type: 'success', message: t('app.newApp.appCreated') })
      onSuccess()
      onClose()
      localStorage.setItem(NEED_REFRESH_APP_LIST_KEY, '1')
      getRedirection(isCurrentWorkspaceEditor, app, push)
    }
    catch (e: any) {
      notify({
        type: 'error',
        message: e.message || t('app.newApp.appCreateFailed'),
      })
    }
    isCreatingRef.current = false
  }, [name, notify, t, appMode, appIcon, description, onSuccess, onClose, push, isCurrentWorkspaceEditor])

  const { run: handleCreateApp } = useDebounceFn(onCreate, { wait: 300 })
  useKeyPress(['meta.enter', 'ctrl.enter'], () => {
    if (isAppsFull)
      return
    handleCreateApp()
  })
  return <>
    <div className='flex h-full justify-center overflow-y-auto overflow-x-hidden'>
      <div className='flex flex-1 shrink-0 justify-end'>
        <div className='px-10'>
          <div className='h-6 w-full 2xl:h-[139px]' />
          <div className='pb-6 pt-1'>
            <span className='title-2xl-semi-bold text-text-primary'>{t('app.newApp.startFromBlank')}</span>
          </div>
          <div className='mb-2 leading-6'>
            <span className='system-sm-semibold text-text-secondary'>{t('app.newApp.chooseAppType')}</span>
          </div>
          <div className='flex w-[660px] flex-col gap-4'>
            <div>
              <div className='flex flex-row gap-2'>
                <AppTypeCard
                  active={appMode === 'workflow'}
                  title={t('app.types.workflow')}
                  description={t('app.newApp.workflowShortDescription')}
                  icon={<div className='flex h-6 w-6 items-center justify-center rounded-md bg-components-icon-bg-indigo-solid'>
                    <RiExchange2Fill className='h-4 w-4 text-components-avatar-shape-fill-stop-100' />
                  </div>}
                  onClick={() => {
                    setAppMode('workflow')
                  }} />
                <AppTypeCard
                  active={appMode === 'advanced-chat'}
                  title={t('app.types.advanced')}
                  description={t('app.newApp.advancedShortDescription')}
                  icon={<div className='flex h-6 w-6 items-center justify-center rounded-md bg-components-icon-bg-blue-light-solid'>
                    <BubbleTextMod className='h-4 w-4 text-components-avatar-shape-fill-stop-100' />
                  </div>}
                  onClick={() => {
                    setAppMode('advanced-chat')
                  }} />
              </div>
            </div>
            <div>
              <div className='mb-2 flex items-center'>
                <button type="button"
                  className='flex cursor-pointer items-center border-0 bg-transparent p-0'
                  onClick={() => setIsAppTypeExpanded(!isAppTypeExpanded)}
                >
                  <span className='system-2xs-medium-uppercase text-text-tertiary'>{t('app.newApp.forBeginners')}</span>
                  <RiArrowRightSLine className={`ml-1 h-4 w-4 text-text-tertiary transition-transform ${isAppTypeExpanded ? 'rotate-90' : ''}`} />
                </button>
              </div>
              {isAppTypeExpanded && (
                <div className='flex flex-row gap-2'>
                  <AppTypeCard
                    active={appMode === 'chat'}
                    title={t('app.types.chatbot')}
                    description={t('app.newApp.chatbotShortDescription')}
                    icon={<div className='flex h-6 w-6 items-center justify-center rounded-md bg-components-icon-bg-blue-solid'>
                      <ChatBot className='h-4 w-4 text-components-avatar-shape-fill-stop-100' />
                    </div>}
                    onClick={() => {
                      setAppMode('chat')
                    }} />
                  <AppTypeCard
                    active={appMode === 'agent-chat'}
                    title={t('app.types.agent')}
                    description={t('app.newApp.agentShortDescription')}
                    icon={<div className='flex h-6 w-6 items-center justify-center rounded-md bg-components-icon-bg-violet-solid'>
                      <Logic className='h-4 w-4 text-components-avatar-shape-fill-stop-100' />
                    </div>}
                    onClick={() => {
                      setAppMode('agent-chat')
                    }} />
                  <AppTypeCard
                    active={appMode === 'completion'}
                    title={t('app.newApp.completeApp')}
                    description={t('app.newApp.completionShortDescription')}
                    icon={<div className='flex h-6 w-6 items-center justify-center rounded-md bg-components-icon-bg-teal-solid'>
                      <ListSparkle className='h-4 w-4 text-components-avatar-shape-fill-stop-100' />
                    </div>}
                    onClick={() => {
                      setAppMode('completion')
                    }} />
                </div>
              )}
            </div>
            <Divider style={{ margin: 0 }} />
            <div className='flex items-center space-x-3'>
              <div className='flex-1'>
                <div className='mb-1 flex h-6 items-center'>
                  <label className='system-sm-semibold text-text-secondary'>{t('app.newApp.captionName')}</label>
                </div>
                <Input
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder={t('app.newApp.appNamePlaceholder') || ''}
                />
              </div>
              <AppIcon
                iconType={appIcon.type}
                icon={appIcon.type === 'emoji' ? appIcon.icon : appIcon.fileId}
                background={appIcon.type === 'emoji' ? appIcon.background : undefined}
                imageUrl={appIcon.type === 'image' ? appIcon.url : undefined}
                size='xxl' className='cursor-pointer rounded-2xl'
                onClick={() => { setShowAppIconPicker(true) }}
              />
              {showAppIconPicker && <AppIconPicker
                onSelect={(payload) => {
                  setAppIcon(payload)
                  setShowAppIconPicker(false)
                }}
                onClose={() => {
                  setShowAppIconPicker(false)
                }}
              />}
            </div>
            <div>
              <div className='mb-1 flex h-6 items-center'>
                <label className='system-sm-semibold text-text-secondary'>{t('app.newApp.captionDescription')}</label>
                <span className='system-xs-regular ml-1 text-text-tertiary'>({t('app.newApp.optional')})</span>
              </div>
              <Textarea
                className='resize-none'
                placeholder={t('app.newApp.appDescriptionPlaceholder') || ''}
                value={description}
                onChange={e => setDescription(e.target.value)}
              />
            </div>
          </div>
          {isAppsFull && <AppsFull className='mt-4' loc='app-create' />}
          <div className='flex items-center justify-between pb-10 pt-5'>
            <div className='system-xs-regular flex cursor-pointer items-center gap-1 text-text-tertiary' onClick={onCreateFromTemplate}>
              <span>{t('app.newApp.noIdeaTip')}</span>
              <div className='p-[1px]'>
                <RiArrowRightLine className='h-3.5 w-3.5' />
              </div>
            </div>
            <div className='flex gap-2'>
              <Button onClick={onClose}>{t('app.newApp.Cancel')}</Button>
              <Button disabled={isAppsFull || !name} className='gap-1' variant="primary" onClick={handleCreateApp}>
                <span>{t('app.newApp.Create')}</span>
                <div className='flex gap-0.5'>
                  <RiCommandLine size={14} className='system-kbd rounded-sm bg-components-kbd-bg-white p-0.5' />
                  <RiCornerDownLeftLine size={14} className='system-kbd rounded-sm bg-components-kbd-bg-white p-0.5' />
                </div>
              </Button>
            </div>
          </div>
        </div>
      </div>
      <div className='relative flex h-full flex-1 shrink justify-start overflow-hidden'>
        <div className='absolute left-0 right-0 top-0 h-6 border-b border-b-divider-subtle 2xl:h-[139px]'></div>
        <div className='max-w-[760px] border-x border-x-divider-subtle'>
          <div className='h-6 2xl:h-[139px]' />
          <AppPreview mode={appMode} />
          <div className='absolute left-0 right-0 border-b border-b-divider-subtle'></div>
          <div className='flex h-[448px] w-[664px] items-center justify-center' style={{ background: 'repeating-linear-gradient(135deg, transparent, transparent 2px, rgba(16,24,40,0.04) 4px,transparent 3px, transparent 6px)' }}>
            <AppScreenShot show={appMode === 'chat'} mode='chat' />
            <AppScreenShot show={appMode === 'advanced-chat'} mode='advanced-chat' />
            <AppScreenShot show={appMode === 'agent-chat'} mode='agent-chat' />
            <AppScreenShot show={appMode === 'completion'} mode='completion' />
            <AppScreenShot show={appMode === 'workflow'} mode='workflow' />
          </div>
          <div className='absolute left-0 right-0 border-b border-b-divider-subtle'></div>
        </div>
      </div>
    </div>
  </>
}
type CreateAppDialogProps = CreateAppProps & {
  show: boolean
}
const CreateAppModal = ({ show, onClose, onSuccess, onCreateFromTemplate, defaultAppMode }: CreateAppDialogProps) => {
  return (
    <FullScreenModal
      overflowVisible
      closable
      open={show}
      onClose={onClose}
    >
      <CreateApp onClose={onClose} onSuccess={onSuccess} onCreateFromTemplate={onCreateFromTemplate} defaultAppMode={defaultAppMode} />
    </FullScreenModal>
  )
}

export default CreateAppModal

type AppTypeCardProps = {
  icon: React.JSX.Element
  title: string
  description: string
  active: boolean
  onClick: () => void
}
function AppTypeCard({ icon, title, description, active, onClick }: AppTypeCardProps) {
  return <div
    className={
      cn(`relative box-content h-[84px] w-[191px] cursor-pointer rounded-xl
      border-[0.5px] border-components-option-card-option-border
      bg-components-panel-on-panel-item-bg p-3 shadow-xs hover:shadow-md`, active
        ? 'shadow-md outline outline-[1.5px] outline-components-option-card-option-selected-border'
        : '')
    }
    onClick={onClick}
  >
    {icon}
    <div className='system-sm-semibold mb-0.5 mt-2 text-text-secondary'>{title}</div>
    <div className='system-xs-regular line-clamp-2 text-text-tertiary' title={description}>{description}</div>
  </div>
}

function AppPreview({ mode }: { mode: AppMode }) {
  const { t } = useTranslation()
  const docLink = useDocLink()
  const modeToPreviewInfoMap = {
    'chat': {
      title: t('app.types.chatbot'),
      description: t('app.newApp.chatbotUserDescription'),
      link: docLink('/guides/application-orchestrate/chatbot-application'),
    },
    'advanced-chat': {
      title: t('app.types.advanced'),
      description: t('app.newApp.advancedUserDescription'),
      link: docLink('/guides/workflow/README', {
        'zh-Hans': '/guides/workflow/readme',
        'ja-JP': '/guides/workflow/concepts',
      }),
    },
    'agent-chat': {
      title: t('app.types.agent'),
      description: t('app.newApp.agentUserDescription'),
      link: docLink('/guides/application-orchestrate/agent'),
    },
    'completion': {
      title: t('app.newApp.completeApp'),
      description: t('app.newApp.completionUserDescription'),
      link: docLink('/guides/application-orchestrate/text-generator', {
        'zh-Hans': '/guides/application-orchestrate/readme',
        'ja-JP': '/guides/application-orchestrate/README',
      }),
    },
    'workflow': {
      title: t('app.types.workflow'),
      description: t('app.newApp.workflowUserDescription'),
      link: docLink('/guides/workflow/README', {
        'zh-Hans': '/guides/workflow/readme',
        'ja-JP': '/guides/workflow/concepts',
      }),
    },
  }
  const previewInfo = modeToPreviewInfoMap[mode]
  return <div className='px-8 py-4'>
    <h4 className='system-sm-semibold-uppercase text-text-secondary'>{previewInfo.title}</h4>
    <div className='system-xs-regular mt-1 min-h-8 max-w-96 text-text-tertiary'>
      <span>{previewInfo.description}</span>
      {previewInfo.link && <Link target='_blank' href={previewInfo.link} className='ml-1 text-text-accent'>{t('app.newApp.learnMore')}</Link>}
    </div>
  </div>
}

function AppScreenShot({ mode, show }: { mode: AppMode; show: boolean }) {
  const { theme } = useTheme()
  const modeToImageMap = {
    'chat': 'Chatbot',
    'advanced-chat': 'Chatflow',
    'agent-chat': 'Agent',
    'completion': 'TextGenerator',
    'workflow': 'Workflow',
  }
  return <picture>
    <source media="(resolution: 1x)" srcSet={`${basePath}/screenshots/${theme}/${modeToImageMap[mode]}.png`} />
    <source media="(resolution: 2x)" srcSet={`${basePath}/screenshots/${theme}/${modeToImageMap[mode]}@2x.png`} />
    <source media="(resolution: 3x)" srcSet={`${basePath}/screenshots/${theme}/${modeToImageMap[mode]}@3x.png`} />
    <Image className={show ? '' : 'hidden'}
      src={`${basePath}/screenshots/${theme}/${modeToImageMap[mode]}.png`}
      alt='App Screen Shot'
      width={664} height={448} />
  </picture>
}
