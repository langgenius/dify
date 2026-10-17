'use client'

import type { AppImportPayload, AppMode, Import } from '@dify/contracts/api/console/apps/types.gen'
import type { Hotkey } from '@tanstack/react-hotkeys'
import { Button } from '@langgenius/dify-ui/button'
import {
  Dialog,
  DialogBody,
  DialogCloseButton,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { Field, FieldError, FieldLabel } from '@langgenius/dify-ui/field'
import { Form } from '@langgenius/dify-ui/form'
import { Input } from '@langgenius/dify-ui/input'
import { Kbd, KbdGroup } from '@langgenius/dify-ui/kbd'
import { Tabs, TabsList, TabsPanel, TabsTab } from '@langgenius/dify-ui/tabs'
import { formatForDisplay, matchesKeyboardEvent } from '@tanstack/react-hotkeys'
import { useMutation, useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import AppsFull from '@/app/components/billing/apps-full-in-dialog'
import { usePluginDependencies } from '@/app/components/workflow/plugin-dependency/hooks'
import { toast } from '@/app/notifications'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { useRouter } from '@/next/navigation'
import { consoleQuery } from '@/service/console'
import { getRedirection } from '@/utils/app-redirection'
import { trackCreateApp } from '@/utils/create-app-tracking'
import { getErrorMessage } from '@/utils/error-message'
import { resolveImportedAppRedirectionTarget } from '@/utils/imported-app-redirection'
import DSLConfirmModal from './dsl-confirm-modal'
import DSLImportWarningDescription from './dsl-import-warning-description'
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

function getImportedAppMode(mode?: string | null): AppMode | undefined {
  switch (mode) {
    case 'completion':
      return 'completion'
    case 'workflow':
      return 'workflow'
    case 'chat':
      return 'chat'
    case 'advanced-chat':
      return 'advanced-chat'
    case 'agent-chat':
      return 'agent-chat'
    case 'agent':
      return 'agent'
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
  const { t } = useTranslation(['app', 'common'])
  const browseButtonRef = useRef<HTMLButtonElement>(null)
  const [currentFile, setCurrentFile] = useState<File | undefined>(droppedFile)
  const [currentTab, setCurrentTab] = useState(activeTab)
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null)
  const { mutateAsync: requestImport } = useMutation(
    consoleQuery.apps.imports.post.mutationOptions({ context: { silent: true } }),
  )
  const importMutation = useMutation({
    mutationFn: async (source: ImportSource) => {
      if (
        source.type === CreateFromDSLModalTab.FROM_FILE &&
        source.file.name.toLowerCase().endsWith('.ifpkg')
      )
        return requestImport({ body: { file: source.file } })

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

      return requestImport({ body })
    },
  })
  const confirmImportMutation = useMutation(
    consoleQuery.apps.imports.byImportId.confirm.post.mutationOptions({
      context: { silent: true },
    }),
  )
  const { handleCheckPluginDependencies } = usePluginDependencies()
  const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())
  const { data: currentUserId } = useSuspenseQuery({
    ...userProfileQueryOptions(),
    select: (data) => data.profile.id,
  })
  const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)
  const deploymentEdition = systemFeatures.deployment_edition
  const { data: appQuota } = useQuery(
    consoleQuery.features.get.queryOptions({
      enabled: deploymentEdition === 'CLOUD',
      select: (data) => data.apps,
    }),
  )
  const isPackageImport =
    currentTab === CreateFromDSLModalTab.FROM_FILE &&
    currentFile?.name.toLowerCase().endsWith('.ifpkg') === true
  // URL imports are classified by the server before applying the appropriate quota.
  const requiresAppQuota = currentTab === CreateFromDSLModalTab.FROM_FILE && !isPackageImport
  const isAppQuotaUnavailable =
    requiresAppQuota && deploymentEdition === 'CLOUD' && appQuota === undefined
  // A limit of 0 means unlimited.
  const isAppsFull =
    requiresAppQuota &&
    deploymentEdition === 'CLOUD' &&
    appQuota !== undefined &&
    appQuota.limit > 0 &&
    appQuota.size >= appQuota.limit
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
          response.status === 'completed-with-warnings' ? (
            <DSLImportWarningDescription
              warnings={response.warnings}
              fallback={t(($) => $['newApp.appCreateDSLWarning'], { ns: 'app' })}
            />
          ) : undefined,
      },
    )
    if (!response.app_id || !appMode) return

    // Dependency checks own their error feedback; a created app remains navigable.
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

    toast.error(
      t(($) => $['newApp.appCreateFailed'], { ns: 'app' }),
      {
        description: response.error || undefined,
      },
    )
  }

  const handleSubmit = async (values: ImportFormValues) => {
    if (isAppQuotaUnavailable || isAppsFull || isImporting) return

    let response: Import
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

      response = await importMutation.mutateAsync(source)
    } catch (error) {
      toast.error(
        t(($) => $['newApp.appCreateFailed'], { ns: 'app' }),
        {
          description: getErrorMessage(error),
        },
      )
      return
    }
    await handleImportResponse(response)
  }

  const handleConfirm = async () => {
    if (!pendingImport || isConfirming) return

    let response: Import
    try {
      response = await confirmImportMutation.mutateAsync({
        params: { import_id: pendingImport.id },
      })
    } catch (error) {
      toast.error(
        t(($) => $['newApp.appCreateFailed'], { ns: 'app' }),
        {
          description: getErrorMessage(error),
        },
      )
      return
    }

    if (response.status === 'completed' || response.status === 'completed-with-warnings') {
      setPendingImport(null)
      await handleCompletedImport(response)
      return
    }

    if (response.status === 'failed')
      toast.error(
        t(($) => $['newApp.appCreateFailed'], { ns: 'app' }),
        { description: response.error || undefined },
      )
  }

  const handleTabChange = (value: string | number) => {
    if (value === CreateFromDSLModalTab.FROM_FILE) setCurrentTab(CreateFromDSLModalTab.FROM_FILE)
    if (value === CreateFromDSLModalTab.FROM_URL) setCurrentTab(CreateFromDSLModalTab.FROM_URL)
  }

  const createDisabled =
    isAppQuotaUnavailable ||
    isAppsFull ||
    (currentTab === CreateFromDSLModalTab.FROM_FILE && !currentFile)

  return (
    <>
      <Dialog
        open={show}
        onOpenChange={(open) => {
          if (!open && !isImporting && !pendingImport) onClose()
        }}
      >
        <DialogContent initialFocus={browseButtonRef}>
          <DialogHeader>
            <DialogTitle>{t(($) => $.importApp, { ns: 'app' })}</DialogTitle>
            <DialogCloseButton
              aria-label={t(($) => $['operation.close'], { ns: 'common' })}
              disabled={isImporting}
            />
          </DialogHeader>
          <Form<ImportFormValues>
            onFormSubmit={handleSubmit}
            onKeyDown={(event) => {
              if (
                !show ||
                createDisabled ||
                isImporting ||
                !!pendingImport ||
                event.defaultPrevented ||
                event.nativeEvent.isComposing ||
                !(event.target instanceof Node) ||
                !event.currentTarget.contains(event.target) ||
                !matchesKeyboardEvent(event.nativeEvent, CREATE_FROM_DSL_HOTKEY)
              )
                return
              event.preventDefault()
              event.stopPropagation()
              if (event.repeat) return
              event.currentTarget.requestSubmit()
            }}
          >
            <Tabs className="contents" value={currentTab} onValueChange={handleTabChange}>
              <TabsList className="h-9 shrink-0 gap-6 border-b border-divider-subtle px-6">
                <TabsTab
                  value={CreateFromDSLModalTab.FROM_FILE}
                  className="h-full pt-0 pb-0"
                  disabled={isImporting}
                >
                  {t(($) => $.importFromFile, { ns: 'app' })}
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
                render={<DialogBody />}
              >
                <Uploader
                  importType="app"
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
                render={<DialogBody />}
              >
                <Field name="dslUrl">
                  <FieldLabel>{t(($) => $.importFromDSLUrl, { ns: 'app' })}</FieldLabel>
                  <Input
                    type="url"
                    inputMode="url"
                    autoComplete="off"
                    required
                    disabled={isImporting}
                    placeholder={t(($) => $.importAppUrlPlaceholder, { ns: 'app' }) || ''}
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
            <DialogFooter>
              <Button disabled={isImporting} onClick={onClose}>
                {t(($) => $['newApp.Cancel'], { ns: 'app' })}
              </Button>
              <Button
                type="submit"
                disabled={createDisabled}
                loading={isImporting}
                variant="primary"
              >
                <span>{t(($) => $['operation.create'], { ns: 'common' })}</span>
                <KbdGroup>
                  {formatForDisplay(CREATE_FROM_DSL_HOTKEY, { parts: true }).map((key) => (
                    <Kbd key={key} color="white">
                      {key}
                    </Kbd>
                  ))}
                </KbdGroup>
              </Button>
            </DialogFooter>
          </Form>
        </DialogContent>
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
