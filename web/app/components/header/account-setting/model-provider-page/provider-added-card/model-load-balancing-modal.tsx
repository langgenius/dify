import type {
  Credential,
  CustomConfigurationModelFixedFields,
  ModelCredential,
  ModelItem,
  ModelLoadBalancingConfig,
  ModelLoadBalancingConfigEntry,
  ModelProvider,
} from '../declarations'
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
  const providerFormSchemaPredefined = configurateMethod === ConfigurationMethodEnum.predefinedModel
  const configFrom = providerFormSchemaPredefined ? 'predefined-model' : 'custom-model'
  const { isLoading, data, refetch } = useQuery({
    ...consoleQuery.workspaces.current.modelProviders.byProvider.models.credentials.get.queryOptions(
      {
        input: {
          params: { provider: provider.provider },
          query: {
            model: model.model,
            model_type: model.model_type,
            config_from: configFrom,
            credential_id: credential?.credential_id,
          },
        },
      },
    ),
    staleTime: 0,
    gcTime: 0,
  })
  const modelCredential = useMemo<ModelCredential | undefined>(
    () =>
      data && {
        ...data,
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
    [data],
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
    consoleQuery.workspaces.current.modelProviders.byProvider.models.post.mutationOptions(),
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
  const { handleRefreshModel } = useRefreshModel()
  const handleSave = async () => {
    try {
      setLoading(true)
      const res = await updateModelLoadBalancingConfig({
        params: { provider: provider.provider },
        body: {
          credential_id: customModelCredential?.credential_id || current_credential_id,
          config_from: configFrom,
          model: model.model,
          model_type: model.model_type,
          load_balancing: {
            ...draftConfig,
            configs: draftConfig!.configs.map(encodeConfigEntrySecretValues),
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
  const handleUpdate = useCallback(
    async (payload?: any, formValues?: Record<string, any>) => {
      const result = await refetch()
      const available_credentials = result.data?.available_credentials || []
      const credentialName = formValues?.__authorization_name__
      const modelCredential = payload?.credential
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
    },
    [refetch, onClose],
  )
  const handleUpdateWhenSwitchCredential = useCallback(async () => {
    const result = await refetch()
    const available_credentials = result.data?.available_credentials || []
    if (!available_credentials.length) onClose?.()
  }, [refetch, onClose])
  const handleRemoveCredential = useCallback(
    (credentialId: string) => {
      setDraftConfig(
        (previous) =>
          previous && {
            ...previous,
            configs: previous.configs.filter((config) => config.credential_id !== credentialId),
          },
      )
      return handleUpdateWhenSwitchCredential()
    },
    [handleUpdateWhenSwitchCredential],
  )
  return (
    <>
      <Dialog
        open={Boolean(model) && open}
        onOpenChange={(open) => {
          if (!open) onClose?.()
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
                <ModelIcon className="mr-2 shrink-0" provider={provider} modelName={model!.model} />
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

          {!draftConfig ? (
            <DialogBody>
              <LoadingPlaceholder />
            </DialogBody>
          ) : (
            <>
              <DialogBody>
                <div
                  className={cn(
                    'relative min-h-16 rounded-xl border bg-components-panel-bg transition-colors',
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
                      className: 'mt-2',
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
                <Button onClick={onClose}>
                  {t(($) => $['operation.cancel'], { ns: 'common' })}
                </Button>
                <Button
                  variant="primary"
                  onClick={handleSave}
                  disabled={
                    loading ||
                    (draftConfig?.enabled &&
                      (draftConfig?.configs.filter((config) => config.enabled).length ?? 0) < 2) ||
                    isLoading
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
