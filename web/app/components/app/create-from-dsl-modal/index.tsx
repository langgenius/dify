'use client'

import type { AppImportPayload, Import } from '@dify/contracts/api/console/apps/types.gen'
import type { Hotkey } from '@tanstack/react-hotkeys'
import type { AppModeEnum } from '@/types/app'
import { Button } from '@langgenius/dify-ui/button'
import {
  Dialog,
  DialogBackdrop,
  DialogPopup,
  DialogPortal,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { Field, FieldControl, FieldError, FieldLabel } from '@langgenius/dify-ui/field'
import { Form } from '@langgenius/dify-ui/form'
import { Kbd, KbdGroup } from '@langgenius/dify-ui/kbd'
import { Tabs, TabsList, TabsPanel, TabsTab } from '@langgenius/dify-ui/tabs'
import { toast } from '@langgenius/dify-ui/toast'
import { formatForDisplay, useHotkey } from '@tanstack/react-hotkeys'
import { useMutation, useSuspenseQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSetNeedRefreshAppList } from '@/app/components/apps/storage'
import AppsFull from '@/app/components/billing/apps-full-in-dialog'
import { usePluginDependencies } from '@/app/components/workflow/plugin-dependency/hooks'
import { userProfileIdAtom } from '@/context/account-state'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { useProviderContext } from '@/context/provider-context'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { useRouter } from '@/next/navigation'
import { consoleClient, consoleQuery } from '@/service/client'
import { useInvalidateAppList } from '@/service/use-apps'
import { AppModeEnum as AppMode } from '@/types/app'
import { getRedirection } from '@/utils/app-redirection'
import { trackCreateApp } from '@/utils/create-app-tracking'
import { getDSLImportWarningDescription } from '@/utils/dsl-import-warning'
import { resolveImportedAppRedirectionTarget } from '@/utils/imported-app-redirection'
import DSLConfirmModal from './dsl-confirm-modal'
import { CreateFromDSLModalTab } from './types'
import { Uploader } from './uploader'

type CreateFromDSLModalProps = {
  show: boolean
  onSuccess?: () => void
  onClose: () => void
  activeTab?: CreateFromDSLModalTab
  dslUrl?: string
  droppedFile?: File
}

type ImportFormValues = {
  dslUrl?: string
}

type PendingImport = {
  id: string
  importedVersion: string
  systemVersion: string
}

type ImportSource =
  | { type: (typeof CreateFromDSLModalTab)['FROM_FILE']; file: File }
  | { type: (typeof CreateFromDSLModalTab)['FROM_URL']; url: string }

const CREATE_FROM_DSL_HOTKEY = 'Mod+Enter' satisfies Hotkey

function getImportedAppMode(mode?: string | null): AppModeEnum | undefined {
  switch (mode) {
    case AppMode.COMPLETION:
      return AppMode.COMPLETION
    case AppMode.WORKFLOW:
      return AppMode.WORKFLOW
    case AppMode.CHAT:
      return AppMode.CHAT
    case AppMode.ADVANCED_CHAT:
      return AppMode.ADVANCED_CHAT
    case AppMode.AGENT_CHAT:
      return AppMode.AGENT_CHAT
    case AppMode.AGENT:
      return AppMode.AGENT
    default:
      return undefined
  }
}

function CreateFromDSLModal({
  show,
  onSuccess,
  onClose,
  activeTab = CreateFromDSLModalTab.FROM_FILE,
  dslUrl = '',
  droppedFile,
}: CreateFromDSLModalProps) {
  const { push } = useRouter()
  const { t } = useTranslation()
  const formRef = useRef<HTMLFormElement>(null)
  const browseButtonRef = useRef<HTMLButtonElement>(null)
  const [currentFile, setCurrentFile] = useState<File | undefined>(droppedFile)
  const [currentTab, setCurrentTab] = useState(activeTab)
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null)
  const importMutation = useMutation({
    mutationFn: async (source: ImportSource) => {
      const body =
        source.type === CreateFromDSLModalTab.FROM_FILE
          ? ({
              mode: 'yaml-content',
              yaml_content: await source.file.text(),
            } satisfies AppImportPayload)
          : ({
              mode: 'yaml-url',
              yaml_url: source.url,
            } satisfies AppImportPayload)

      return consoleClient.apps.imports.post({ body })
    },
  })
  const confirmImportMutation = useMutation(
    consoleQuery.apps.imports.byImportId.confirm.post.mutationOptions(),
  )
  const { handleCheckPluginDependencies } = usePluginDependencies()
  const setNeedRefresh = useSetNeedRefreshAppList()
  const invalidateAppList = useInvalidateAppList()
  const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())
  const currentUserId = useAtomValue(userProfileIdAtom)
  const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)
  const { plan, enableBilling } = useProviderContext()
  const isAppsFull = enableBilling && plan.usage.buildApps >= plan.total.buildApps
  const isImporting = importMutation.isPending
  const isConfirming = confirmImportMutation.isPending

  const handleCompletedImport = async (response: Import) => {
    const appMode = getImportedAppMode(response.app_mode)

    if (appMode) trackCreateApp({ source: 'studio_upload', appMode })
    onSuccess?.()
    onClose()

    toast(
      t(($) => $[response.status === 'completed' ? 'newApp.appCreated' : 'newApp.caution'], {
        ns: 'app',
      }),
      {
        type: response.status === 'completed' ? 'success' : 'warning',
        description:
          response.status === 'completed-with-warnings'
            ? getDSLImportWarningDescription(response.warnings) ||
              t(($) => $['newApp.appCreateDSLWarning'], { ns: 'app' })
            : undefined,
      },
    )
    setNeedRefresh('1')
    invalidateAppList()

    if (!response.app_id || !appMode) return

    await handleCheckPluginDependencies(response.app_id)
    const redirectionTarget = await resolveImportedAppRedirectionTarget({
      id: response.app_id,
      mode: appMode,
      permission_keys: response.permission_keys,
    })
    getRedirection(redirectionTarget, push, {
      currentUserId,
      resourceMaintainer: currentUserId,
      workspacePermissionKeys,
      isRbacEnabled: systemFeatures.rbac_enabled,
    })
  }

  const handleImportResponse = async (response: Import) => {
    if (response.status === 'completed' || response.status === 'completed-with-warnings') {
      await handleCompletedImport(response)
      return
    }

    if (response.status === 'pending') {
      setPendingImport({
        id: response.id,
        importedVersion: response.imported_dsl_version ?? '',
        systemVersion: response.current_dsl_version ?? '',
      })
      return
    }

    toast.error(response.error || t(($) => $['newApp.appCreateFailed'], { ns: 'app' }))
  }

  const handleSubmit = async (values: ImportFormValues) => {
    if (isAppsFull || isImporting) return

    try {
      let source: ImportSource
      if (currentTab === CreateFromDSLModalTab.FROM_FILE) {
        if (!currentFile) return
        source = { type: CreateFromDSLModalTab.FROM_FILE, file: currentFile }
      } else {
        const yamlUrl = values.dslUrl?.trim()
        if (!yamlUrl) return
        source = { type: CreateFromDSLModalTab.FROM_URL, url: yamlUrl }
      }

      const response = await importMutation.mutateAsync(source)
      await handleImportResponse(response)
    } catch {
      toast.error(t(($) => $['newApp.appCreateFailed'], { ns: 'app' }))
    }
  }

  const handleConfirm = async () => {
    if (!pendingImport || isConfirming) return

    try {
      const response = await confirmImportMutation.mutateAsync({
        params: { import_id: pendingImport.id },
      })
      if (response.status === 'completed' || response.status === 'completed-with-warnings') {
        setPendingImport(null)
        await handleCompletedImport(response)
        return
      }

      if (response.status === 'failed')
        toast.error(response.error || t(($) => $['newApp.appCreateFailed'], { ns: 'app' }))
    } catch {
      toast.error(t(($) => $['newApp.appCreateFailed'], { ns: 'app' }))
    }
  }

  const handleTabChange = (value: string | number) => {
    if (value === CreateFromDSLModalTab.FROM_FILE) setCurrentTab(CreateFromDSLModalTab.FROM_FILE)
    if (value === CreateFromDSLModalTab.FROM_URL) setCurrentTab(CreateFromDSLModalTab.FROM_URL)
  }

  const createDisabled =
    isAppsFull || (currentTab === CreateFromDSLModalTab.FROM_FILE && !currentFile)

  useHotkey(CREATE_FROM_DSL_HOTKEY, () => formRef.current?.requestSubmit(), {
    enabled: show && !createDisabled && !isImporting && !pendingImport,
    ignoreInputs: false,
  })

  return (
    <>
      <Dialog
        open={show}
        onOpenChange={(open) => {
          if (!open && !isImporting && !pendingImport) onClose()
        }}
      >
        <DialogPortal>
          <DialogBackdrop />
          <DialogPopup
            initialFocus={browseButtonRef}
            className="fixed top-1/2 left-1/2 max-h-[80dvh] w-120 max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 overflow-hidden overscroll-contain text-left align-middle"
          >
            <div className="flex items-center justify-between pt-6 pr-5 pb-3 pl-6">
              <DialogTitle className="title-2xl-semi-bold text-text-primary">
                {t(($) => $.importApp, { ns: 'app' })}
              </DialogTitle>
              <Button
                variant="ghost"
                size="small"
                aria-label={t(($) => $['operation.cancel'], { ns: 'common' })}
                className="size-8 p-0"
                disabled={isImporting}
                onClick={onClose}
              >
                <span aria-hidden className="i-ri-close-line size-5 text-text-tertiary" />
              </Button>
            </div>
            <Form<ImportFormValues> ref={formRef} onFormSubmit={handleSubmit}>
              <Tabs value={currentTab} onValueChange={handleTabChange}>
                <TabsList className="h-9 gap-6 border-b border-divider-subtle px-6">
                  <TabsTab
                    value={CreateFromDSLModalTab.FROM_FILE}
                    className="h-full pt-0 pb-0"
                    disabled={isImporting}
                  >
                    {t(($) => $.importFromDSLFile, { ns: 'app' })}
                  </TabsTab>
                  <TabsTab
                    value={CreateFromDSLModalTab.FROM_URL}
                    className="h-full pt-0 pb-0"
                    disabled={isImporting}
                  >
                    {t(($) => $.importFromDSLUrl, { ns: 'app' })}
                  </TabsTab>
                </TabsList>
                <TabsPanel
                  value={CreateFromDSLModalTab.FROM_FILE}
                  tabIndex={-1}
                  className="px-6 py-4"
                >
                  <Uploader
                    browseButtonRef={browseButtonRef}
                    className="mt-0"
                    file={currentFile}
                    updateFile={setCurrentFile}
                    disabled={isImporting}
                  />
                </TabsPanel>
                <TabsPanel
                  value={CreateFromDSLModalTab.FROM_URL}
                  tabIndex={-1}
                  className="px-6 py-4"
                >
                  <Field name="dslUrl">
                    <FieldLabel>{t(($) => $.importFromDSLUrl, { ns: 'app' })}</FieldLabel>
                    <FieldControl
                      type="url"
                      inputMode="url"
                      autoComplete="off"
                      required
                      disabled={isImporting}
                      placeholder={t(($) => $.importFromDSLUrlPlaceholder, { ns: 'app' }) || ''}
                      defaultValue={dslUrl}
                    />
                    <FieldError />
                  </Field>
                </TabsPanel>
              </Tabs>
              {isAppsFull && (
                <div className="px-6">
                  <AppsFull className="mt-0" loc="app-create-dsl" />
                </div>
              )}
              <div className="flex justify-end px-6 py-5">
                <Button className="mr-2" disabled={isImporting} onClick={onClose}>
                  {t(($) => $['newApp.Cancel'], { ns: 'app' })}
                </Button>
                <Button
                  type="submit"
                  disabled={createDisabled}
                  loading={isImporting}
                  variant="primary"
                  className="gap-1"
                >
                  <span>{t(($) => $['newApp.Create'], { ns: 'app' })}</span>
                  <KbdGroup>
                    {CREATE_FROM_DSL_HOTKEY.split('+').map((key) => (
                      <Kbd key={key} color="white">
                        {formatForDisplay(key)}
                      </Kbd>
                    ))}
                  </KbdGroup>
                </Button>
              </div>
            </Form>
          </DialogPopup>
        </DialogPortal>
      </Dialog>
      {pendingImport && (
        <DSLConfirmModal
          versions={{
            importedVersion: pendingImport.importedVersion,
            systemVersion: pendingImport.systemVersion,
          }}
          onCancel={() => {
            if (!isConfirming) setPendingImport(null)
          }}
          onConfirm={handleConfirm}
          confirmLoading={isConfirming}
        />
      )}
    </>
  )
}

export default CreateFromDSLModal
