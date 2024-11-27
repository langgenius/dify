'use client'

import { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useRouter } from 'next/navigation'
import { useContext, useContextSelector } from 'use-context-selector'
import { RiArrowRightLine, RiCommandLine, RiCornerDownLeftLine, RiExchange2Fill } from '@remixicon/react'
import Link from 'next/link'
import { useDebounceFn, useKeyPress } from 'ahooks'
import AppIconPicker from '../../base/app-icon-picker'
import type { AppIconSelection } from '../../base/app-icon-picker'
import Button from '@/app/components/base/button'
import Divider from '@/app/components/base/divider'
import cn from '@/utils/classnames'
import AppsContext, { useAppContext } from '@/context/app-context'
import { useProviderContext } from '@/context/provider-context'
import { ToastContext } from '@/app/components/base/toast'
import type { AppMode } from '@/types/app'
import { createApp } from '@/service/apps'
import Input from '@/app/components/base/input'
import Textarea from '@/app/components/base/textarea'
import AppIcon from '@/app/components/base/app-icon'
import AppsFull from '@/app/components/billing/apps-full-in-dialog'
import { BubbleTextMod, ChatBot, ListSparkle, Logic } from '@/app/components/base/icons/src/vender/solid/communication'
import Tooltip from '@/app/components/base/tooltip'
import { NEED_REFRESH_APP_LIST_KEY } from '@/config'
import { getRedirection } from '@/utils/app-redirection'
import FullScreenModal from '@/app/components/base/fullscreen-modal'

type CreateAppProps = {
  onSuccess: () => void
  onClose: () => void
  onCreateFromTemplate?: () => void
}

function CreateApp({ onClose, onSuccess, onCreateFromTemplate }: CreateAppProps) {
  const { t } = useTranslation()
  const { push } = useRouter()
  const { notify } = useContext(ToastContext)
  const mutateApps = useContextSelector(AppsContext, state => state.mutateApps)

  const [appMode, setAppMode] = useState<AppMode>('chat')
  const [appIcon, setAppIcon] = useState<AppIconSelection>({ type: 'emoji', icon: '🤖', background: '#FFEAD5' })
  const [showAppIconPicker, setShowAppIconPicker] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')

  const { plan, enableBilling } = useProviderContext()
  const isAppsFull = (enableBilling && plan.usage.buildApps >= plan.total.buildApps)
  const { isCurrentWorkspaceEditor } = useAppContext()

  const isCreatingRef = useRef(false)

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
      mutateApps()
      localStorage.setItem(NEED_REFRESH_APP_LIST_KEY, '1')
      getRedirection(isCurrentWorkspaceEditor, app, push)
    }
    catch (e) {
      notify({ type: 'error', message: t('app.newApp.appCreateFailed') })
    }
    isCreatingRef.current = false
  }, [name, notify, t, appMode, appIcon, description, onSuccess, onClose, mutateApps, push, isCurrentWorkspaceEditor])

  const { run: handleCreateApp } = useDebounceFn(onCreate, { wait: 300 })
  useKeyPress(['meta.enter', 'ctrl.enter'], () => {
    if (isAppsFull)
      return
    handleCreateApp()
  })
  return <>
    <div className='flex justify-center h-full'>
      <div className='flex-1 flex justify-end'>
        <div className='px-10 w-[740px] max-w-[760px]'>
          <div className='w-full h-6 xl:h-[139px]' />
          <div className='pt-1 pb-6'>
            <span className='title-2xl-semi-bold text-text-primary'>{t('app.newApp.startFromBlank')}</span>
          </div>
          <div className='leading-6 mb-2'>
            <span className='system-sm-semibold text-text-secondary'>{t('app.newApp.chooseAppType')}</span>
          </div>
          <div className='flex flex-col gap-4'>
            <div>
              <div className='mb-2'>
                <span className='system-2xs-medium-uppercase text-text-tertiary'>{t('app.newApp.forBeginners')}</span>
              </div>
              <div className='flex flex-row gap-2'>
                <AppTypeCard
                  active={appMode === 'chat'}
                  title={t('app.types.chatbot')}
                  description={t('app.newApp.chatbotShortDescription')}
                  tooltipContent={t('app.newApp.chatbotDescription')}
                  icon={<div className='w-6 h-6 bg-components-icon-bg-blue-solid rounded-md flex items-center justify-center'>
                    <ChatBot className='w-4 h-4 text-components-avatar-shape-fill-stop-100' />
                  </div>}
                  onClick={() => {
                    setAppMode('chat')
                  }} />
                <AppTypeCard
                  active={appMode === 'agent-chat'}
                  title={t('app.types.agent')}
                  description={t('app.newApp.agentShortDescription')}
                  tooltipContent={t('app.newApp.agentDescription')}
                  icon={<div className='w-6 h-6 bg-components-icon-bg-violet-solid rounded-md flex items-center justify-center'>
                    <Logic className='w-4 h-4 text-components-avatar-shape-fill-stop-100' />
                  </div>}
                  onClick={() => {
                    setAppMode('agent-chat')
                  }} />
                <AppTypeCard
                  active={appMode === 'completion'}
                  title={t('app.newApp.completeApp')}
                  description={t('app.newApp.completionShortDescription')}
                  tooltipContent={t('app.newApp.completionDescription')}
                  icon={<div className='w-6 h-6 bg-components-icon-bg-teal-solid rounded-md flex items-center justify-center'>
                    <ListSparkle className='w-4 h-4 text-components-avatar-shape-fill-stop-100' />
                  </div>}
                  onClick={() => {
                    setAppMode('completion')
                  }} />
              </div>
            </div>
            <div>
              <div className='mb-2'>
                <span className='system-2xs-medium-uppercase text-text-tertiary'>{t('app.newApp.forAdvanced')}</span>
              </div>
              <div className='flex flex-row gap-2'>
                <AppTypeCard
                  beta
                  active={appMode === 'advanced-chat'}
                  title={t('app.types.advanced')}
                  description={t('app.newApp.advancedShortDescription')}
                  tooltipContent={t('app.newApp.advancedDescription')}
                  icon={<div className='w-6 h-6 bg-components-icon-bg-blue-light-solid rounded-md flex items-center justify-center'>
                    <BubbleTextMod className='w-4 h-4 text-components-avatar-shape-fill-stop-100' />
                  </div>}
                  onClick={() => {
                    setAppMode('advanced-chat')
                  }} />
                <AppTypeCard
                  beta
                  active={appMode === 'workflow'}
                  title={t('app.types.workflow')}
                  description={t('app.newApp.workflowShortDescription')}
                  tooltipContent={t('app.newApp.workflowDescription')}
                  icon={<div className='w-6 h-6 bg-components-icon-bg-indigo-solid rounded-md flex items-center justify-center'>
                    <RiExchange2Fill className='w-4 h-4 text-components-avatar-shape-fill-stop-100' />
                  </div>}
                  onClick={() => {
                    setAppMode('workflow')
                  }} />
              </div>
            </div>
            <Divider style={{ margin: 0 }} />
            <div className='flex space-x-3 items-center'>
              <div className='flex-1'>
                <div className='h-6 flex items-center mb-1'>
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
              <div className='h-6 flex items-center mb-1'>
                <label className='system-sm-semibold text-text-secondary'>{t('app.newApp.captionDescription')}</label>
                <span className='system-xs-regular text-text-tertiary ml-1'>({t('app.newApp.optional')})</span>
              </div>
              <Textarea
                className='resize-none'
                placeholder={t('app.newApp.appDescriptionPlaceholder') || ''}
                value={description}
                onChange={e => setDescription(e.target.value)}
              />
            </div>
          </div>
          <div className='pt-5 pb-10 flex justify-between items-center'>
            <div className='flex gap-1 items-center system-xs-regular text-text-tertiary cursor-pointer' onClick={onCreateFromTemplate}>
              <span>{t('app.newApp.noIdeaTip')}</span>
              <div className='p-[1px]'>
                <RiArrowRightLine className='w-3.5 h-3.5' />
              </div>
            </div>
            <div className='flex gap-2'>
              <Button onClick={onClose}>{t('app.newApp.Cancel')}</Button>
              <Button disabled={isAppsFull || !name} className='gap-1' variant="primary" onClick={handleCreateApp}>
                <span>{t('app.newApp.Create')}</span>
                <div className='flex gap-0.5'>
                  <RiCommandLine size={14} className='p-0.5 system-kbd bg-components-kbd-bg-white rounded-sm' />
                  <RiCornerDownLeftLine size={14} className='p-0.5 system-kbd bg-components-kbd-bg-white rounded-sm' />
                </div>
              </Button>
            </div>
          </div>
        </div>
      </div>
      <div className='flex-1 h-full flex justify-start relative'>
        <div className='h-6 xl:h-[139px] absolute left-0 top-0 right-0 border-b border-b-divider-subtle'></div>
        <div className='w-[740px] max-w-[760px] border-x border-x-divider-subtle'>
          <div className='h-6 xl:h-[139px]' />
          <AppPreview mode={appMode} />
          <div className='absolute left-0 right-0 border-b border-b-divider-subtle'></div>
          <div className='min-w-[600px] min-h-[400px]' style={{ background: 'repeating-linear-gradient(135deg, transparent, transparent 4px, rgba(16,24,40,0.04) 5px,transparent 4px, transparent 8px)' }}>
            <AppScreenShot mode={appMode} />
          </div>
          <div className='absolute left-0 right-0 border-b border-b-divider-subtle'></div>
        </div>
      </div>
    </div>
    {
      isAppsFull && (
        <div className='px-8 py-2'>
          <AppsFull loc='app-create' />
        </div>
      )
    }
  </>
}
type CreateAppDialogProps = CreateAppProps & {
  show: boolean
}
const CreateAppModal = ({ show, onClose, onSuccess, onCreateFromTemplate }: CreateAppDialogProps) => {
  return (
    <FullScreenModal
      overflowVisible
      closable
      open={show}
      onClose={onClose}
    >
      <CreateApp onClose={onClose} onSuccess={onSuccess} onCreateFromTemplate={onCreateFromTemplate} />
    </FullScreenModal>
  )
}

export default CreateAppModal

type AppTypeCardProps = {
  icon: JSX.Element
  beta?: boolean
  title: string
  description: string
  tooltipContent: string
  active: boolean
  onClick: () => void
}
function AppTypeCard({ icon, title, beta = false, description, tooltipContent, active, onClick }: AppTypeCardProps) {
  const { t } = useTranslation()
  return <Tooltip
    popupContent={
      <div className='max-w-[280px] body-xs-regular text-text-secondary'>{tooltipContent}</div>
    }
  >
    <div
      className={cn(`w-[191px] h-[84px] p-3 border-[0.5px] relative box-content
      rounded-xl border-components-option-card-option-border
      bg-components-panel-on-panel-item-bg shadow-xs cursor-pointer`, active ? 'outline outline-[1.5px] outline-components-option-card-option-selected-border' : '')}
      onClick={onClick}
    >
      {beta && <div className='px-[5px] py-[3px]
      rounded-[5px] min-w-[18px] absolute top-3 right-3
      border border-divider-deep system-2xs-medium-uppercase text-text-tertiary'>{t('common.menus.status')}</div>}
      {icon}
      <div className='system-sm-semibold text-text-secondary mt-2 mb-0.5'>{title}</div>
      <div className='system-xs-regular text-text-tertiary'>{description}</div>
    </div>
  </Tooltip>
}

function AppPreview({ mode }: { mode: AppMode }) {
  const { t } = useTranslation()
  const modeToPreviewInfoMap = {
    'chat': {
      title: t('app.types.chatbot'),
      description: t('app.newApp.chatbotUserDescription'),
      link: 'https://docs.dify.ai/guides/application-orchestrate/conversation-application?fallback=true',
    },
    'advanced-chat': {
      title: t('app.types.advanced'),
      description: t('app.newApp.advancedUserDescription'),
      link: 'https://docs.dify.ai/guides/workflow',
    },
    'agent-chat': {
      title: t('app.types.agent'),
      description: t('app.newApp.agentUserDescription'),
      link: 'https://docs.dify.ai/guides/application-orchestrate/agent',
    },
    'completion': {
      title: t('app.newApp.completeApp'),
      description: t('app.newApp.completionUserDescription'),
      link: null,
    },
    'workflow': {
      title: t('app.types.workflow'),
      description: t('app.newApp.workflowUserDescription'),
      link: 'https://docs.dify.ai/guides/workflow',
    },
  }
  const previewInfo = modeToPreviewInfoMap[mode]
  return <div className='px-8 py-4'>
    <h4 className='system-sm-semibold-uppercase text-text-secondary'>{previewInfo.title}</h4>
    <div className='mt-1 system-xs-regular text-text-tertiary max-w-96 min-h-8'>
      <span>{previewInfo.description}</span>
      {previewInfo.link && <Link target='_blank' href={previewInfo.link} className='text-text-accent ml-1'>{t('app.newApp.learnMore')}</Link>}
    </div>
  </div>
}

function AppScreenShot({ mode }: { mode: AppMode }) {
  const modeToImageMap = {
    'chat': 'Chatbot',
    'advanced-chat': 'ChatFlow',
    'agent-chat': 'Agent',
    'completion': 'TextGenerator',
    'workflow': 'Workflow',
  }
  return <>
    <img className='dark:hidden' width="100%"
      src={`/screenshots/Light/${modeToImageMap[mode]}.png`}
      srcSet={`/screenshots/Light/${modeToImageMap[mode]}@2x.png 2x,/screenshots/Light/${modeToImageMap[mode]}@3x.png 3x`} alt='screen shot' />
    <img className='hidden dark:inline-block' width="100%"
      src={`/screenshots/Dark/${modeToImageMap[mode]}.png`}
      srcSet={`/screenshots/Dark/${modeToImageMap[mode]}@2x.png 2x,/screenshots/Dark/${modeToImageMap[mode]}@3x.png 3x`} alt='screen shot' />
  </>
}
