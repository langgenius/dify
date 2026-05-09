'use client'

import type { AppIconSelection } from '../../base/app-icon-picker'
import { Button } from '@langgenius/dify-ui/button'

import { cn } from '@langgenius/dify-ui/cn'
import { toast } from '@langgenius/dify-ui/toast'
import { RiArrowRightLine, RiArrowRightSLine, RiExchange2Fill } from '@remixicon/react'
import { useDebounceFn, useKeyPress } from 'ahooks'
import { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import AppIcon from '@/app/components/base/app-icon'
import Divider from '@/app/components/base/divider'
import { BubbleTextMod, ChatBot, ListSparkle, Logic } from '@/app/components/base/icons/src/vender/solid/communication'
import Input from '@/app/components/base/input'
import Textarea from '@/app/components/base/textarea'
import AppsFull from '@/app/components/billing/apps-full-in-dialog'
import { NEED_REFRESH_APP_LIST_KEY } from '@/config'
import { useAppContext } from '@/context/app-context'
import { useProviderContext } from '@/context/provider-context'
import useTheme from '@/hooks/use-theme'
import { useRouter } from '@/next/navigation'
import { createApp } from '@/service/apps'
import { AppModeEnum } from '@/types/app'
import { getRedirection } from '@/utils/app-redirection'
import { trackCreateApp } from '@/utils/create-app-tracking'
import { basePath } from '@/utils/var'
import AppIconPicker from '../../base/app-icon-picker'
import ShortcutsName from '../../workflow/shortcuts-name'
import { CreateAppDialogShell } from '../create-app-dialog-shell'

type CreateAppProps = {
  onSuccess: () => void
  onClose: () => void
  onCreateFromTemplate?: () => void
  defaultAppMode?: AppModeEnum
}

const shouldExpandBeginnerAppTypes = (appMode?: AppModeEnum) => {
  return appMode === AppModeEnum.CHAT || appMode === AppModeEnum.AGENT_CHAT || appMode === AppModeEnum.COMPLETION
}

function CreateApp({ onClose, onSuccess, onCreateFromTemplate, defaultAppMode }: CreateAppProps) {
  const { t } = useTranslation()
  const { push } = useRouter()

  const [appMode, setAppMode] = useState<AppModeEnum>(defaultAppMode || AppModeEnum.ADVANCED_CHAT)
  const [appIcon, setAppIcon] = useState<AppIconSelection>({ type: 'emoji', icon: '🤖', background: '#FFEAD5' })
  const [showAppIconPicker, setShowAppIconPicker] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [isAppTypeExpanded, setIsAppTypeExpanded] = useState(() => shouldExpandBeginnerAppTypes(defaultAppMode))

  const { plan, enableBilling } = useProviderContext()
  const isAppsFull = (enableBilling && plan.usage.buildApps >= plan.total.buildApps)
  const { isCurrentWorkspaceEditor } = useAppContext()

  const isCreatingRef = useRef(false)

  const onCreate = useCallback(async () => {
    if (!appMode) {
      toast.error(t('newApp.appTypeRequired', { ns: 'app' }))
      return
    }
    if (!name.trim()) {
      toast.error(t('newApp.nameNotEmpty', { ns: 'app' }))
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

      trackCreateApp({ appMode: app.mode })

      toast.success(t('newApp.appCreated', { ns: 'app' }))
      onSuccess()
      onClose()
      localStorage.setItem(NEED_REFRESH_APP_LIST_KEY, '1')
      getRedirection(isCurrentWorkspaceEditor, app, push)
    }
    catch (error) {
      toast.error(error instanceof Error ? error.message : t('newApp.appCreateFailed', { ns: 'app' }))
    }
    isCreatingRef.current = false
  }, [name, t, appMode, appIcon, description, onSuccess, onClose, push, isCurrentWorkspaceEditor])

  const { run: handleCreateApp } = useDebounceFn(onCreate, { wait: 300 })
  useKeyPress(['meta.enter', 'ctrl.enter'], () => {
    if (isAppsFull)
      return
    handleCreateApp()
  })
  return (
    <>
      <div className="flex h-full justify-center overflow-x-hidden overflow-y-auto">
        <div className="flex flex-1 shrink-0 justify-end">
          <div className="px-10">
            <div className="h-6 w-full 2xl:h-[139px]" />
            <div className="pt-1 pb-6">
              <span className="title-2xl-semi-bold text-text-primary">{t('newApp.startFromBlank', { ns: 'app' })}</span>
            </div>
            <div className="mb-2 leading-6">
              <span className="system-sm-semibold text-text-secondary">{t('newApp.chooseAppType', { ns: 'app' })}</span>
            </div>
            <div className="flex w-[660px] flex-col gap-4">
              <div>
                <div className="flex flex-row gap-2">
                  <AppTypeCard
                    active={appMode === AppModeEnum.WORKFLOW}
                    title={t('types.workflow', { ns: 'app' })}
                    description={t('newApp.workflowShortDescription', { ns: 'app' })}
                    icon={(
                      <div className="flex h-6 w-6 items-center justify-center rounded-md bg-components-icon-bg-indigo-solid">
                        <RiExchange2Fill className="h-4 w-4 text-components-avatar-shape-fill-stop-100" />
                      </div>
                    )}
                    onClick={() => {
                      setAppMode(AppModeEnum.WORKFLOW)
                    }}
                  />
                  <AppTypeCard
                    active={appMode === AppModeEnum.ADVANCED_CHAT}
                    title={t('types.advanced', { ns: 'app' })}
                    description={t('newApp.advancedShortDescription', { ns: 'app' })}
                    icon={(
                      <div className="flex h-6 w-6 items-center justify-center rounded-md bg-components-icon-bg-blue-light-solid">
                        <BubbleTextMod className="h-4 w-4 text-components-avatar-shape-fill-stop-100" />
                      </div>
                    )}
                    onClick={() => {
                      setAppMode(AppModeEnum.ADVANCED_CHAT)
                    }}
                  />
                </div>
              </div>
              <div>
                <div className="mb-2 flex items-center">
                  <button
                    type="button"
                    className="flex cursor-pointer items-center border-0 bg-transparent p-0"
                    onClick={() => setIsAppTypeExpanded(!isAppTypeExpanded)}
                  >
                    <span className="system-2xs-medium-uppercase text-text-tertiary">{t('newApp.forBeginners', { ns: 'app' })}</span>
                    <RiArrowRightSLine className={`ml-1 h-4 w-4 text-text-tertiary transition-transform ${isAppTypeExpanded ? 'rotate-90' : ''}`} />
                  </button>
                </div>
                {isAppTypeExpanded && (
                  <div className="flex flex-row gap-2">
                    <AppTypeCard
                      active={appMode === AppModeEnum.CHAT}
                      title={t('types.chatbot', { ns: 'app' })}
                      description={t('newApp.chatbotShortDescription', { ns: 'app' })}
                      icon={(
                        <div className="flex h-6 w-6 items-center justify-center rounded-md bg-components-icon-bg-blue-solid">
                          <ChatBot className="h-4 w-4 text-components-avatar-shape-fill-stop-100" />
                        </div>
                      )}
                      onClick={() => {
                        setAppMode(AppModeEnum.CHAT)
                      }}
                    />
                    <AppTypeCard
                      active={appMode === AppModeEnum.AGENT_CHAT}
                      title={t('types.agent', { ns: 'app' })}
                      description={t('newApp.agentShortDescription', { ns: 'app' })}
                      icon={(
                        <div className="flex h-6 w-6 items-center justify-center rounded-md bg-components-icon-bg-violet-solid">
                          <Logic className="h-4 w-4 text-components-avatar-shape-fill-stop-100" />
                        </div>
                      )}
                      onClick={() => {
                        setAppMode(AppModeEnum.AGENT_CHAT)
                      }}
                    />
                    <AppTypeCard
                      active={appMode === AppModeEnum.COMPLETION}
                      title={t('newApp.completeApp', { ns: 'app' })}
                      description={t('newApp.completionShortDescription', { ns: 'app' })}
                      icon={(
                        <div className="flex h-6 w-6 items-center justify-center rounded-md bg-components-icon-bg-teal-solid">
                          <ListSparkle className="h-4 w-4 text-components-avatar-shape-fill-stop-100" />
                        </div>
                      )}
                      onClick={() => {
                        setAppMode(AppModeEnum.COMPLETION)
                      }}
                    />
                  </div>
                )}
              </div>
              <Divider style={{ margin: 0 }} />
              <div className="flex items-center space-x-3">
                <div className="flex-1">
                  <div className="mb-1 flex h-6 items-center">
                    <label className="system-sm-semibold text-text-secondary">{t('newApp.captionName', { ns: 'app' })}</label>
                  </div>
                  <Input
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder={t('newApp.appNamePlaceholder', { ns: 'app' }) || ''}
                  />
                </div>
                <AppIcon
                  iconType={appIcon.type}
                  icon={appIcon.type === 'emoji' ? appIcon.icon : appIcon.fileId}
                  background={appIcon.type === 'emoji' ? appIcon.background : undefined}
                  imageUrl={appIcon.type === 'image' ? appIcon.url : undefined}
                  size="xxl"
                  className="cursor-pointer rounded-2xl"
                  onClick={() => { setShowAppIconPicker(true) }}
                />
                {showAppIconPicker && (
                  <AppIconPicker
                    onSelect={(payload) => {
                      setAppIcon(payload)
                      setShowAppIconPicker(false)
                    }}
                    onClose={() => {
                      setShowAppIconPicker(false)
                    }}
                  />
                )}
              </div>
              <div>
                <div className="mb-1 flex h-6 items-center">
                  <label className="system-sm-semibold text-text-secondary">{t('newApp.captionDescription', { ns: 'app' })}</label>
                  <span className="ml-1 system-xs-regular text-text-tertiary">
                    (
                    {t('newApp.optional', { ns: 'app' })}
                    )
                  </span>
                </div>
                <Textarea
                  className="resize-none"
                  placeholder={t('newApp.appDescriptionPlaceholder', { ns: 'app' }) || ''}
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                />
              </div>
            </div>
            {isAppsFull && <AppsFull className="mt-4" loc="app-create" />}
            <div className="flex items-center justify-between pt-5 pb-10">
              <div className="flex cursor-pointer items-center gap-1 system-xs-regular text-text-tertiary" onClick={onCreateFromTemplate}>
                <span>{t('newApp.noIdeaTip', { ns: 'app' })}</span>
                <div className="p-px">
                  <RiArrowRightLine className="h-3.5 w-3.5" />
                </div>
              </div>
              <div className="flex gap-2">
                <Button onClick={onClose}>{t('newApp.Cancel', { ns: 'app' })}</Button>
                <Button disabled={isAppsFull || !name} className="gap-1" variant="primary" onClick={handleCreateApp}>
                  <span>{t('newApp.Create', { ns: 'app' })}</span>
                  <ShortcutsName keys={['ctrl', '↵']} bgColor="white" />
                </Button>
              </div>
            </div>
          </div>
        </div>
        <div className="relative flex h-full flex-1 shrink justify-start overflow-hidden">
          <div className="absolute top-0 right-0 left-0 h-6 border-b border-b-divider-subtle 2xl:h-[139px]"></div>
          <div className="max-w-[760px] border-x border-x-divider-subtle">
            <div className="h-6 2xl:h-[139px]" />
            <AppPreview mode={appMode} />
            <div className="absolute right-0 left-0 border-b border-b-divider-subtle"></div>
            <div className="flex h-[448px] w-[664px] items-center justify-center" style={{ background: 'repeating-linear-gradient(135deg, transparent, transparent 2px, rgba(16,24,40,0.04) 4px,transparent 3px, transparent 6px)' }}>
              <AppScreenShot show={appMode === AppModeEnum.CHAT} mode={AppModeEnum.CHAT} />
              <AppScreenShot show={appMode === AppModeEnum.ADVANCED_CHAT} mode={AppModeEnum.ADVANCED_CHAT} />
              <AppScreenShot show={appMode === AppModeEnum.AGENT_CHAT} mode={AppModeEnum.AGENT_CHAT} />
              <AppScreenShot show={appMode === AppModeEnum.COMPLETION} mode={AppModeEnum.COMPLETION} />
              <AppScreenShot show={appMode === AppModeEnum.WORKFLOW} mode={AppModeEnum.WORKFLOW} />
            </div>
            <div className="absolute right-0 left-0 border-b border-b-divider-subtle"></div>
          </div>
        </div>
      </div>
    </>
  )
}
type CreateAppDialogProps = CreateAppProps & {
  show: boolean
}
const CreateAppModal = ({ show, onClose, onSuccess, onCreateFromTemplate, defaultAppMode }: CreateAppDialogProps) => {
  const { t } = useTranslation()

  return (
    <CreateAppDialogShell
      show={show}
      title={t('newApp.startFromBlank', { ns: 'app' })}
      contentClassName="overflow-visible"
      onClose={onClose}
    >
      <CreateApp onClose={onClose} onSuccess={onSuccess} onCreateFromTemplate={onCreateFromTemplate} defaultAppMode={defaultAppMode} />
    </CreateAppDialogShell>
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
  return (
    <div
      className={
        cn(`relative box-content h-[84px] w-[191px] cursor-pointer rounded-xl
      border-[0.5px] border-components-option-card-option-border
      bg-components-panel-on-panel-item-bg p-3 shadow-xs hover:shadow-md`, active
          ? 'shadow-md outline-[1.5px] outline-components-option-card-option-selected-border outline-solid'
          : '')
      }
      onClick={onClick}
    >
      {icon}
      <div className="mt-2 mb-0.5 system-sm-semibold text-text-secondary">{title}</div>
      <div className="line-clamp-2 system-xs-regular text-text-tertiary" title={description}>{description}</div>
    </div>
  )
}

function AppPreview({ mode }: { mode: AppModeEnum }) {
  const { t } = useTranslation()
  const modeToPreviewInfoMap = {
    [AppModeEnum.CHAT]: {
      title: t('types.chatbot', { ns: 'app' }),
      description: t('newApp.chatbotUserDescription', { ns: 'app' }),
    },
    [AppModeEnum.ADVANCED_CHAT]: {
      title: t('types.advanced', { ns: 'app' }),
      description: t('newApp.advancedUserDescription', { ns: 'app' }),
    },
    [AppModeEnum.AGENT_CHAT]: {
      title: t('types.agent', { ns: 'app' }),
      description: t('newApp.agentUserDescription', { ns: 'app' }),
    },
    [AppModeEnum.COMPLETION]: {
      title: t('newApp.completeApp', { ns: 'app' }),
      description: t('newApp.completionUserDescription', { ns: 'app' }),
    },
    [AppModeEnum.WORKFLOW]: {
      title: t('types.workflow', { ns: 'app' }),
      description: t('newApp.workflowUserDescription', { ns: 'app' }),
    },
  }
  const previewInfo = modeToPreviewInfoMap[mode]
  return (
    <div className="px-8 py-4">
      <h4 className="system-sm-semibold-uppercase text-text-secondary">{previewInfo.title}</h4>
      <div className="mt-1 min-h-8 max-w-96 system-xs-regular text-text-tertiary">
        <span>{previewInfo.description}</span>
      </div>
    </div>
  )
}

function AppScreenShot({ mode, show }: { mode: AppModeEnum, show: boolean }) {
  const { theme } = useTheme()
  const modeToImageMap = {
    [AppModeEnum.CHAT]: 'Chatbot',
    [AppModeEnum.ADVANCED_CHAT]: 'Chatflow',
    [AppModeEnum.AGENT_CHAT]: 'Agent',
    [AppModeEnum.COMPLETION]: 'TextGenerator',
    [AppModeEnum.WORKFLOW]: 'Workflow',
  }
  return (
    <picture>
      <source media="(resolution: 1x)" srcSet={`${basePath}/screenshots/${theme}/${modeToImageMap[mode]}.png`} />
      <source media="(resolution: 2x)" srcSet={`${basePath}/screenshots/${theme}/${modeToImageMap[mode]}@2x.png`} />
      <source media="(resolution: 3x)" srcSet={`${basePath}/screenshots/${theme}/${modeToImageMap[mode]}@3x.png`} />
      <img
        className={show ? '' : 'hidden'}
        src={`${basePath}/screenshots/${theme}/${modeToImageMap[mode]}.png`}
        alt="App Screen Shot"
        width={664}
        height={448}
      />
    </picture>
  )
}
