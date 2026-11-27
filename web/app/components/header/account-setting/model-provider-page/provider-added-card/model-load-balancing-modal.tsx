import type {
  Credential,
  CustomConfigurationModelFixedFields,
  ModelCredential,
  ModelItem,
  ModelLoadBalancingConfig,
  ModelLoadBalancingConfigEntry,
  ModelProvider,
} from '../declarations'
import { Alert, AlertActions, AlertTitle } from '@langgenius/dify-ui/alert'
import {
  AlertDialog,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { useMutation, useQuery } from '@tanstack/react-query'
import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LoadingPlaceholder } from '@/app/components/base/loading-placeholder'
import { SwitchCredentialInLoadBalancing } from '@/app/components/header/account-setting/model-provider-page/model-auth'
import { toast } from '@/app/notifications'
import { consoleQuery } from '@/service/console'
import { useOwnedQueryError } from '@/service/use-owned-query-error'
import { useRequestErrorMessage } from '@/service/use-request-error-message'
import { ConfigurationMethodEnum, FormTypeEnum } from '../declarations'
import { useRefreshModel } from '../hooks'
import { useAuth } from '../model-auth/hooks/use-auth'
import ModelIcon from '../model-icon'
import ModelName from '../model-name'
import ModelLoadBalancingConfigs from './model-load-balancing-configs'

export type ModelLoadBalancingModalProps = {
  provider: ModelProvider
  configurateMethod: ConfigurationMethodEnum
  currentCustomConfigurationModelFixedFields?: CustomConfigurationModelFixedFields
  model: ModelItem
  credential?: Credential
  open?: boolean
  onClose?: () => void
  onSave?: (provider: string) => void
}
// model balancing config modal
const ModelLoadBalancingModal = ({
  provider,
  configurateMethod,
  currentCustomConfigurationModelFixedFields,
  model,
  credential,
  open = false,
  onClose,
  onSave,
}: ModelLoadBalancingModalProps) => {
  const { t } = useTranslation(['common', 'modelProvider'])
  const modelCredentialLabelId = useId()
  const { doingAction, deleteModel, openConfirmDelete, closeConfirmDelete, handleConfirmDelete } =
    useAuth(provider, configurateMethod, currentCustomConfigurationModelFixedFields, {
      isModelCredential: true,
    })
  const [loading, setLoading] = useState(false)
  const [pendingDraftSyncs, setPendingDraftSyncs] = useState(0)
  const [removedCredentialIds, setRemovedCredentialIds] = useState<string[]>([])
  const providerFormSchemaPredefined = configurateMethod === ConfigurationMethodEnum.predefinedModel
  const configFrom = providerFormSchemaPredefined ? 'predefined-model' : 'custom-model'
  const credentialsQuery = useQuery(
    consoleQuery.workspaces.current.modelProviders.byProvider.models.credentials.get.queryOptions({
      input: {
        params: { provider: provider.provider },
        query: {
          model: model.model,
          model_type: model.model_type,
          config_from: configFrom,
          credential_id: credential?.credential_id,
        },
      },
    }),
  )
  const { data, refetch } = credentialsQuery
  const credentialsLoad = useOwnedQueryError(credentialsQuery)
  const credentialsErrorMessage = useRequestErrorMessage(
    credentialsLoad?.error,
    t(($) => $['modelProvider.loadFailed'], { ns: 'modelProvider' }),
  )
  const modelCredential = useMemo<ModelCredential | undefined>(
    () =>
      data && {
        ...data,
        available_credentials: data.available_credentials.filter(
          (credential) => !removedCredentialIds.includes(credential.credential_id),
        ),
        current_credential_id: data.current_credential_id ?? undefined,
        current_credential_name: data.current_credential_name ?? undefined,
        load_balancing: {
          enabled: data.load_balancing.enabled,
          configs: data.load_balancing.configs.map((config) => ({
            ...config,
            credential_id: config.credential_id ?? undefined,
            // Credential values are untyped JSON form values in the console API response.
            credentials: config.credentials as ModelLoadBalancingConfigEntry['credentials'],
          })),
        },
      },
    [data, removedCredentialIds],
  )
  const { load_balancing, current_credential_id, available_credentials, current_credential_name } =
    modelCredential ?? {}
  const originalConfig = load_balancing
  const [draftConfig, setDraftConfig] = useState<ModelLoadBalancingConfig>()
  const originalConfigMap = useMemo(() => {
    if (!originalConfig) return {}
    return originalConfig?.configs.reduce(
      (prev, config) => {
        if (config.id) prev[config.id] = config
        return prev
      },
      {} as Record<string, ModelLoadBalancingConfigEntry>,
    )
  }, [originalConfig])
  const draftIdentity = JSON.stringify([
    provider.provider,
    model.model,
    model.model_type,
    configFrom,
    credential?.credential_id,
    open,
  ])
  const previousDraftIdentity = useRef(draftIdentity)
  useEffect(() => {
    const changed = previousDraftIdentity.current !== draftIdentity
    previousDraftIdentity.current = draftIdentity
    // Credential edits refetch the server configuration, but must preserve local edits.
    setDraftConfig((previous) => (changed ? originalConfig : (previous ?? originalConfig)))
  }, [originalConfig, draftIdentity])
  const toggleModalBalancing = useCallback(
    (enabled: boolean) => {
      if (draftConfig) {
        setDraftConfig({
          ...draftConfig,
          enabled,
        })
      }
    },
    [draftConfig],
  )
  const extendedSecretFormSchemas = useMemo(() => {
    if (providerFormSchemaPredefined) {
      return (
        provider?.provider_credential_schema?.credential_form_schemas?.filter(
          ({ type }) => type === FormTypeEnum.secretInput,
        ) ?? []
      )
    }
    return (
      provider?.model_credential_schema?.credential_form_schemas?.filter(
        ({ type }) => type === FormTypeEnum.secretInput,
      ) ?? []
    )
  }, [
    provider?.model_credential_schema?.credential_form_schemas,
    provider?.provider_credential_schema?.credential_form_schemas,
    providerFormSchemaPredefined,
  ])
  const encodeConfigEntrySecretValues = useCallback(
    (entry: ModelLoadBalancingConfigEntry) => {
      const result = { ...entry, credentials: { ...entry.credentials } }
      extendedSecretFormSchemas.forEach(({ variable }) => {
        if (
          entry.id &&
          result.credentials[variable] === originalConfigMap[entry.id]?.credentials?.[variable]
        )
          result.credentials[variable] = '[__HIDDEN__]'
      })
      return result
    },
    [extendedSecretFormSchemas, originalConfigMap],
  )
  const { mutateAsync: updateModelLoadBalancingConfig } = useMutation(
    consoleQuery.workspaces.current.modelProviders.byProvider.models.post.mutationOptions({
      meta: { errorToast: false },
    }),
  )
  const initialCustomModelCredential = useMemo(() => {
    if (!current_credential_id) return undefined
    return {
      credential_id: current_credential_id,
      credential_name: current_credential_name,
    }
  }, [current_credential_id, current_credential_name])
  const [customModelCredential, setCustomModelCredential] = useState<Credential | undefined>(
    initialCustomModelCredential,
  )
  const credentialIdToSave = customModelCredential?.credential_id || current_credential_id
  const saveBlockedByCredentialChange =
    doingAction ||
    pendingDraftSyncs > 0 ||
    (!providerFormSchemaPredefined && !credentialIdToSave) ||
    Boolean(credentialIdToSave && removedCredentialIds.includes(credentialIdToSave))
  const { handleRefreshModel } = useRefreshModel()
  const handleSave = async () => {
    if (saveBlockedByCredentialChange || loading || !draftConfig) return
    try {
      setLoading(true)
      const res = await updateModelLoadBalancingConfig({
        params: { provider: provider.provider },
        body: {
          credential_id: credentialIdToSave,
          config_from: configFrom,
          model: model.model,
          model_type: model.model_type,
          load_balancing: {
            ...draftConfig,
            configs: draftConfig.configs.map(encodeConfigEntrySecretValues),
            enabled: Boolean(draftConfig?.enabled),
          },
        },
      })
      if (res.result === 'success') {
        toast.success(t(($) => $['actionMsg.modifiedSuccessfully'], { ns: 'common' }))
        handleRefreshModel(provider, currentCustomConfigurationModelFixedFields, false)
        onSave?.(provider.provider)
        onClose?.()
      } else {
        toast.error(
          (
            res as {
              error?: string
            }
          )?.error || t(($) => $['actionMsg.modifiedUnsuccessfully'], { ns: 'common' }),
        )
      }
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t(($) => $['actionMsg.modifiedUnsuccessfully'], { ns: 'common' }),
      )
    } finally {
      setLoading(false)
    }
  }
  const handleDeleteModel = useCallback(async () => {
    await handleConfirmDelete()
    onClose?.()
  }, [handleConfirmDelete, onClose])
  const syncCredentialDraft = useCallback(async (sync: () => Promise<void>) => {
    setPendingDraftSyncs((count) => count + 1)
    try {
      await sync()
    } finally {
      setPendingDraftSyncs((count) => count - 1)
    }
  }, [])
  const handleUpdate = useCallback(
    (modelCredential?: Credential, formValues?: Record<string, unknown>) =>
      syncCredentialDraft(async () => {
        const result = await refetch()
        const available_credentials = result.data?.available_credentials || []
        const credentialName = formValues?.__authorization_name__
        if (!available_credentials.length) {
          onClose?.()
          return
        }
        if (!modelCredential) {
          const currentCredential = available_credentials.find(
            (c) => c.credential_name === credentialName,
          )
          if (currentCredential) {
            setDraftConfig((prev: any) => {
              if (!prev) return prev
              return {
                ...prev,
                configs: [
                  ...prev.configs,
                  {
                    credential_id: currentCredential.credential_id,
                    enabled: true,
                    name: currentCredential.credential_name,
                  },
                ],
              }
            })
          }
        } else {
          setDraftConfig((prev) => {
            if (!prev) return prev
            const newConfigs = [...prev.configs]
            const prevIndex = newConfigs.findIndex(
              (item) =>
                item.credential_id === modelCredential.credential_id && item.name !== '__inherit__',
            )
            const newIndex = available_credentials.findIndex(
              (c) => c.credential_id === modelCredential.credential_id,
            )
            if (newIndex > -1 && prevIndex > -1) {
              newConfigs[prevIndex] = {
                ...newConfigs[prevIndex]!,
                name: available_credentials[newIndex]!.credential_name || '',
              }
            }
            return {
              ...prev,
              configs: newConfigs,
            }
          })
        }
      }),
    [refetch, onClose, syncCredentialDraft],
  )
  const handleUpdateWhenSwitchCredential = useCallback(async () => {
    const result = await refetch()
    const available_credentials = result.data?.available_credentials || []
    if (!available_credentials.length) onClose?.()
  }, [refetch, onClose])
  const handleRemoveCredential = useCallback(
    (credentialId: string) => {
      setRemovedCredentialIds((previous) => [...previous, credentialId])
      setDraftConfig(
        (previous) =>
          previous && {
            ...previous,
            configs: previous.configs.filter((config) => config.credential_id !== credentialId),
          },
      )
      setCustomModelCredential((previous) =>
        previous?.credential_id === credentialId ? undefined : previous,
      )
      return syncCredentialDraft(handleUpdateWhenSwitchCredential)
    },
    [handleUpdateWhenSwitchCredential, syncCredentialDraft],
  )
  return (
    <>
      <Dialog
        open={Boolean(model) && open}
        disablePointerDismissal
        onOpenChange={(open, eventDetails) => {
          if (open) return
          if (loading) {
            eventDetails.cancel()
            return
          }
          onClose?.()
        }}
      >
        <DialogContent className="w-160">
          <DialogHeader>
            <DialogTitle>
              {draftConfig?.enabled
                ? t(($) => $['modelProvider.auth.configLoadBalancing'], { ns: 'modelProvider' })
                : t(($) => $['modelProvider.auth.configModel'], { ns: 'modelProvider' })}
            </DialogTitle>
            {Boolean(model) && (
              <div className="flex h-5 items-center">
                <ModelIcon className="me-2 shrink-0" provider={provider} modelName={model!.model} />
                <ModelName
                  className="grow system-md-regular text-text-secondary"
                  modelItem={model!}
                  showModelType
                  showMode
                  showContextSize
                />
              </div>
            )}
          </DialogHeader>

          {credentialsLoad ? (
            <DialogBody>
              <Alert type="error">
                <AlertTitle>{credentialsErrorMessage}</AlertTitle>
                <AlertActions>
                  <Button
                    size="small"
                    loading={credentialsLoad.retrying}
                    onClick={credentialsLoad.retry}
                  >
                    {t(($) => $['operation.retry'], { ns: 'common' })}
                  </Button>
                </AlertActions>
              </Alert>
            </DialogBody>
          ) : !draftConfig ? (
            <DialogBody>
              <LoadingPlaceholder />
            </DialogBody>
          ) : (
            <>
              <DialogBody inert={loading}>
                <div
                  className={cn(
                    'relative min-h-16 rounded-xl border bg-components-panel-bg transition-colors',
                    loading && 'opacity-60',
                    draftConfig.enabled
                      ? 'border-components-panel-border'
                      : 'cursor-default border-util-colors-blue-blue-600',
                  )}
                >
                  {draftConfig.enabled && (
                    <button
                      type="button"
                      className="absolute inset-0 z-10 cursor-pointer rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-state-accent-solid"
                      aria-labelledby={modelCredentialLabelId}
                      onClick={() => toggleModalBalancing(false)}
                    />
                  )}
                  <div className="flex items-center gap-2 px-3.75 py-3 select-none">
                    <div className="flex size-8 shrink-0 grow-0 items-center justify-center rounded-lg border border-components-card-border bg-components-card-bg">
                      {Boolean(model) && (
                        <ModelIcon
                          className="shrink-0"
                          provider={provider}
                          modelName={model!.model}
                        />
                      )}
                    </div>
                    <div className="grow">
                      <div id={modelCredentialLabelId} className="text-sm text-text-secondary">
                        {providerFormSchemaPredefined
                          ? t(($) => $['modelProvider.auth.providerManaged'], {
                              ns: 'modelProvider',
                            })
                          : t(($) => $['modelProvider.auth.specifyModelCredential'], {
                              ns: 'modelProvider',
                            })}
                      </div>
                      <div className="text-xs text-text-tertiary">
                        {providerFormSchemaPredefined
                          ? t(($) => $['modelProvider.auth.providerManagedTip'], {
                              ns: 'modelProvider',
                            })
                          : t(($) => $['modelProvider.auth.specifyModelCredentialTip'], {
                              ns: 'modelProvider',
                            })}
                      </div>
                    </div>
                    {!providerFormSchemaPredefined && (
                      <div className="relative z-20">
                        <SwitchCredentialInLoadBalancing
                          provider={provider}
                          customModelCredential={
                            customModelCredential ?? initialCustomModelCredential
                          }
                          setCustomModelCredential={setCustomModelCredential}
                          model={model}
                          credentials={available_credentials}
                          onUpdate={handleUpdateWhenSwitchCredential}
                          onRemove={handleRemoveCredential}
                        />
                      </div>
                    )}
                  </div>
                </div>
                {modelCredential && (
                  <ModelLoadBalancingConfigs
                    {...{
                      draftConfig,
                      setDraftConfig,
                      provider,
                      currentCustomConfigurationModelFixedFields: {
                        __model_name: model.model,
                        __model_type: model.model_type,
                      },
                      configurationMethod: model.fetch_from,
                      className: cn('mt-2', loading && 'opacity-60'),
                      modelCredential,
                      onUpdate: handleUpdate,
                      onRemove: handleRemoveCredential,
                      model: {
                        model: model.model,
                        model_type: model.model_type,
                      },
                    }}
                  />
                )}
              </DialogBody>

              <DialogFooter>
                {!providerFormSchemaPredefined && (
                  <Button
                    disabled={loading}
                    onClick={() =>
                      openConfirmDelete(undefined, {
                        model: model.model,
                        model_type: model.model_type,
                      })
                    }
                    className="me-auto text-components-button-destructive-secondary-text"
                  >
                    {t(($) => $['modelProvider.auth.removeModel'], { ns: 'modelProvider' })}
                  </Button>
                )}
                <DialogClose render={<Button />} disabled={loading}>
                  {t(($) => $['operation.cancel'], { ns: 'common' })}
                </DialogClose>
                <Button
                  variant="primary"
                  onClick={handleSave}
                  loading={loading}
                  disabled={
                    (draftConfig?.enabled &&
                      (draftConfig?.configs.filter((config) => config.enabled).length ?? 0) < 2) ||
                    saveBlockedByCredentialChange
                  }
                >
                  {t(($) => $['operation.save'], { ns: 'common' })}
                </Button>
              </DialogFooter>
            </>
          )}
          <AlertDialog open={!!deleteModel} onOpenChange={(open) => !open && closeConfirmDelete()}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {t(($) => $['modelProvider.confirmDelete'], { ns: 'modelProvider' })}
                </AlertDialogTitle>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancelButton>
                  {t(($) => $['operation.cancel'], { ns: 'common' })}
                </AlertDialogCancelButton>
                <AlertDialogConfirmButton disabled={doingAction} onClick={handleDeleteModel}>
                  {t(($) => $['operation.confirm'], { ns: 'common' })}
                </AlertDialogConfirmButton>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </DialogContent>
      </Dialog>
    </>
  )
}
export default memo(ModelLoadBalancingModal)
