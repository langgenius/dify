'use client'

import type { Hotkey } from '@tanstack/react-hotkeys'
import type { AppIconSelection } from '../../base/app-icon-picker'
import { zPostAppsBody } from '@dify/contracts/api/console/apps/zod.gen'
import { Button } from '@langgenius/dify-ui/button'
import { Kbd, KbdGroup } from '@langgenius/dify-ui/kbd'
import { SegmentedControl, SegmentedControlItem } from '@langgenius/dify-ui/segmented-control'
import { toast } from '@langgenius/dify-ui/toast'
import { formatForDisplay, useHotkey } from '@tanstack/react-hotkeys'
import { useMutation, useSuspenseQuery } from '@tanstack/react-query'
import { useDebounceFn } from 'ahooks'
import { useAtomValue, useSetAtom } from 'jotai'
import { useCallback, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Divider from '@/app/components/base/divider'
import AppsFull from '@/app/components/billing/apps-full-in-dialog'
import { difyBuilderPendingCreationAtom } from '@/app/components/workflow-app/components/dify-builder/creation'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { useRouter } from '@/next/navigation'
import { consoleQuery } from '@/service/console'
import { AppModeEnum } from '@/types/app'
import { getRedirection } from '@/utils/app-redirection'
import { trackCreateApp } from '@/utils/create-app-tracking'
import { hasPermission } from '@/utils/permission'
import { CreateAppDialogShell } from '../create-app-dialog-shell'
import { AppBuilderInput } from './app-builder-input'
import { AppPreview } from './app-preview'
import { AppTypeSelector } from './app-type-selector'
import { BlankAppFields } from './blank-app-fields'

type CreateAppProps = {
  onClose: () => void
  onCreateFromTemplate?: () => void
  defaultAppMode?: AppModeEnum
}

const CREATE_APP_HOTKEY = 'Mod+Enter' satisfies Hotkey

function CreateApp({ onClose, onCreateFromTemplate, defaultAppMode }: CreateAppProps) {
  const { t } = useTranslation()
  const { push } = useRouter()
  const titleId = useId()

  const [blankAppMode, setBlankAppMode] = useState<AppModeEnum>(
    defaultAppMode || AppModeEnum.ADVANCED_CHAT,
  )
  const [builderAppMode, setBuilderAppMode] = useState(
    defaultAppMode === AppModeEnum.WORKFLOW ? AppModeEnum.WORKFLOW : AppModeEnum.ADVANCED_CHAT,
  )
  const [creationMethod, setCreationMethod] = useState<'builder' | 'blank'>('builder')
  const [builderPrompt, setBuilderPrompt] = useState('')
  const setPendingBuilderCreation = useSetAtom(difyBuilderPendingCreationAtom)
  const [appIcon, setAppIcon] = useState<AppIconSelection>({
    type: 'emoji',
    icon: '🤖',
    background: '#FFEAD5',
  })
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')

  const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())
  const deploymentEdition = systemFeatures.deployment_edition
  const { data: features } = useSuspenseQuery(consoleQuery.features.get.queryOptions())
  const appQuota = features.apps
  const appBuilderEnabled = features.dify_builder_enabled
  const isBuilder = appBuilderEnabled && creationMethod === 'builder'
  const appMode = isBuilder ? builderAppMode : blankAppMode
  const setAppMode = isBuilder ? setBuilderAppMode : setBlankAppMode
  const isAppQuotaUnavailable = deploymentEdition === 'CLOUD' && appQuota === undefined
  // A limit of 0 means unlimited.
  const isAppsFull =
    deploymentEdition === 'CLOUD' &&
    appQuota !== undefined &&
    appQuota.limit > 0 &&
    appQuota.size >= appQuota.limit
  const { data: currentUserId } = useSuspenseQuery({
    ...userProfileQueryOptions(),
    select: (data) => data.profile.id,
  })
  const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)
  const isRbacEnabled = systemFeatures.rbac_enabled
  const canCreateApp = hasPermission(workspacePermissionKeys, 'app.create_and_management')
  const { mutateAsync: createApp } = useMutation(consoleQuery.apps.post.mutationOptions())
  const creatingRef = useRef(false)
  const [isCreating, setIsCreating] = useState(false)

  const onCreate = useCallback(async () => {
    if (isAppQuotaUnavailable || isAppsFull || !canCreateApp) return

    if (!appMode) {
      toast.error(t(($) => $['newApp.appTypeRequired'], { ns: 'app' }))
      return
    }
    const appModeResult = zPostAppsBody.shape.mode.safeParse(appMode)
    if (!appModeResult.success) {
      toast.error(t(($) => $['newApp.appTypeRequired'], { ns: 'app' }))
      return
    }
    if (isBuilder && !builderPrompt.trim()) return
    if (!isBuilder && !name.trim()) {
      toast.error(t(($) => $['newApp.nameNotEmpty'], { ns: 'app' }))
      return
    }
    if (creatingRef.current) return
    creatingRef.current = true
    setIsCreating(true)
    try {
      const app = await createApp({
        body: {
          name: isBuilder ? t(($) => $['newApp.defaultName'], { ns: 'app' }) : name,
          description: isBuilder ? '' : description,
          icon_type: appIcon.type,
          icon: appIcon.type === 'emoji' ? appIcon.icon : appIcon.fileId,
          icon_background: appIcon.type === 'emoji' ? appIcon.background : undefined,
          mode: appModeResult.data,
        },
      })

      try {
        await trackCreateApp({ source: 'studio_blank', appMode })
      } catch {
        // Analytics should not turn a successful app creation into a failed flow.
      }

      toast.success(t(($) => $['newApp.appCreated'], { ns: 'app' }))
      if (isBuilder) setPendingBuilderCreation({ appId: app.id, prompt: builderPrompt.trim() })
      onClose()
      getRedirection(app, push, {
        currentUserId,
        resourceMaintainer: app.maintainer,
        workspacePermissionKeys,
        isRbacEnabled,
      })
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t(($) => $['newApp.appCreateFailed'], { ns: 'app' }),
      )
    } finally {
      creatingRef.current = false
      setIsCreating(false)
    }
  }, [
    isAppQuotaUnavailable,
    isAppsFull,
    canCreateApp,
    currentUserId,
    name,
    t,
    appMode,
    appIcon,
    description,
    onClose,
    push,
    workspacePermissionKeys,
    isRbacEnabled,
    createApp,
    isBuilder,
    builderPrompt,
    setPendingBuilderCreation,
  ])

  const { run: handleCreateApp } = useDebounceFn(onCreate, { wait: 300 })
  useHotkey(
    CREATE_APP_HOTKEY,
    () => {
      if (isAppQuotaUnavailable || isAppsFull || !canCreateApp) return
      handleCreateApp()
    },
    {
      ignoreInputs: false,
    },
  )
  return (
    <>
      <div className="flex h-full justify-center overflow-x-hidden overflow-y-auto">
        <div className="flex flex-1 shrink-0 justify-end">
          <form
            className="px-10"
            aria-labelledby={titleId}
            onSubmit={(event) => {
              event.preventDefault()
              handleCreateApp()
            }}
          >
            <div className="h-6 w-full 2xl:h-34.75" />
            <div className="flex items-center justify-between gap-2 pt-1 pb-6">
              <h2 id={titleId} className="title-2xl-semi-bold text-text-primary">
                {isBuilder
                  ? t(($) => $['newApp.startFromAppBuilder'], { ns: 'app' })
                  : t(($) => $['newApp.startFromBlank'], { ns: 'app' })}
              </h2>
              {appBuilderEnabled && (
                <SegmentedControl
                  aria-label={t(($) => $['newApp.creationMethod'], { ns: 'app' })}
                  value={creationMethod}
                  onValueChange={setCreationMethod}
                  disabled={isCreating}
                >
                  <SegmentedControlItem value="builder">
                    <span aria-hidden className="i-custom-public-app-builder-builder-mark size-4" />
                    <span className="p-0.5">
                      {t(($) => $['difyBuilder.panelTitle'], { ns: 'workflow' })}
                    </span>
                  </SegmentedControlItem>
                  <SegmentedControlItem value="blank">
                    <span aria-hidden className="i-ri-edit-line size-4" />
                    <span className="p-0.5">{t(($) => $['newApp.blank'], { ns: 'app' })}</span>
                  </SegmentedControlItem>
                </SegmentedControl>
              )}
            </div>
            <div className="mb-2 leading-6">
              <span className="system-sm-semibold text-text-secondary">
                {t(($) => $['newApp.chooseAppType'], { ns: 'app' })}
              </span>
            </div>
            <div className="flex w-165 flex-col gap-4">
              <AppTypeSelector
                appMode={appMode}
                onAppModeChange={setAppMode}
                isBuilder={isBuilder}
                defaultAppMode={defaultAppMode}
              />
              <Divider style={{ margin: 0 }} />
              {isBuilder ? (
                <AppBuilderInput
                  titleId={titleId}
                  prompt={builderPrompt}
                  onPromptChange={setBuilderPrompt}
                  isCreating={isCreating}
                  createDisabled={isAppQuotaUnavailable || !canCreateApp || isAppsFull}
                />
              ) : (
                <BlankAppFields
                  name={name}
                  onNameChange={setName}
                  description={description}
                  onDescriptionChange={setDescription}
                  appIcon={appIcon}
                  onAppIconChange={setAppIcon}
                />
              )}
            </div>
            {isAppsFull && <AppsFull className="mt-4" loc="app-create" />}
            <div className="flex items-center justify-between pt-5 pb-10">
              <button
                type="button"
                className="flex cursor-pointer items-center gap-1 border-none bg-transparent p-0 text-left system-xs-regular text-text-tertiary focus-visible:ring-1 focus-visible:ring-components-input-border-active focus-visible:outline-hidden"
                onClick={onCreateFromTemplate}
              >
                <span>{t(($) => $['newApp.noIdeaTip'], { ns: 'app' })}</span>
                <div className="p-px">
                  <span aria-hidden className="i-ri-arrow-right-line size-3.5" />
                </div>
              </button>
              {!isBuilder && (
                <div className="flex gap-2">
                  <Button onClick={onClose}>{t(($) => $['newApp.Cancel'], { ns: 'app' })}</Button>
                  <Button
                    type="submit"
                    disabled={isAppQuotaUnavailable || !canCreateApp || isAppsFull || !name}
                    loading={isCreating}
                    variant="primary"
                  >
                    <span>{t(($) => $['newApp.Create'], { ns: 'app' })}</span>
                    <KbdGroup>
                      {CREATE_APP_HOTKEY.split('+').map((key) => (
                        <Kbd key={key} color="white">
                          {formatForDisplay(key)}
                        </Kbd>
                      ))}
                    </KbdGroup>
                  </Button>
                </div>
              )}
            </div>
          </form>
        </div>
        <AppPreview mode={appMode} />
      </div>
    </>
  )
}
type CreateAppDialogProps = CreateAppProps & {
  show: boolean
}
const CreateAppModal = ({
  show,
  onClose,
  onCreateFromTemplate,
  defaultAppMode,
}: CreateAppDialogProps) => {
  const { t } = useTranslation()

  return (
    <CreateAppDialogShell
      show={show}
      title={t(($) => $['newApp.startFromBlank'], { ns: 'app' })}
      contentClassName="overflow-visible"
      onClose={onClose}
    >
      <CreateApp
        onClose={onClose}
        onCreateFromTemplate={onCreateFromTemplate}
        defaultAppMode={defaultAppMode}
      />
    </CreateAppDialogShell>
  )
}

export default CreateAppModal
