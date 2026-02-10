import type {
  Credential,
  CustomConfigurationModelFixedFields,
  ModelItem,
  ModelLoadBalancingConfig,
  ModelLoadBalancingConfigEntry,
  ModelProvider,
} from '../declarations'
import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import Confirm from '@/app/components/base/confirm'
import Loading from '@/app/components/base/loading'
import Modal from '@/app/components/base/modal'
import { useToastContext } from '@/app/components/base/toast'
import { SwitchCredentialInLoadBalancing } from '@/app/components/header/account-setting/model-provider-page/model-auth'
import {
  useGetModelCredential,
  useUpdateModelLoadBalancingConfig,
} from '@/service/use-models'
import { cn } from '@/utils/classnames'
import {
  ConfigurationMethodEnum,
  FormTypeEnum,
} from '../declarations'
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
  const { t } = useTranslation()
  const { notify } = useToastContext()
  const {
    doingAction,
    deleteModel,
    openConfirmDelete,
    closeConfirmDelete,
    handleConfirmDelete,
  } = useAuth(
    provider,
    configurateMethod,
    currentCustomConfigurationModelFixedFields,
    {
      isModelCredential: true,
    },
  )
  const [loading, setLoading] = useState(false)
  const providerFormSchemaPredefined = configurateMethod === ConfigurationMethodEnum.predefinedModel
  const configFrom = providerFormSchemaPredefined ? 'predefined-model' : 'custom-model'
  const {
    isLoading,
    data,
    refetch,
  } = useGetModelCredential(true, provider.provider, credential?.credential_id, model.model, model.model_type, configFrom)
  const modelCredential = data
  const {
    load_balancing,
    current_credential_id,
    available_credentials,
    current_credential_name,
  } = modelCredential ?? {}
  const originalConfig = load_balancing
  const [draftConfig, setDraftConfig] = useState<ModelLoadBalancingConfig>()
  const originalConfigMap = useMemo(() => {
    if (!originalConfig)
      return {}
    return originalConfig?.configs.reduce((prev, config) => {
      if (config.id)
        prev[config.id] = config
      return prev
    }, {} as Record<string, ModelLoadBalancingConfigEntry>)
  }, [originalConfig])
  useEffect(() => {
    if (originalConfig)
      setDraftConfig(originalConfig)
  }, [originalConfig])

  const toggleModalBalancing = useCallback((enabled: boolean) => {
    if (draftConfig) {
      setDraftConfig({
        ...draftConfig,
        enabled,
      })
    }
  }, [draftConfig])

  const extendedSecretFormSchemas = useMemo(
    () => {
      if (providerFormSchemaPredefined) {
        return provider?.provider_credential_schema?.credential_form_schemas?.filter(
          ({ type }) => type === FormTypeEnum.secretInput,
        ) ?? []
      }
      return provider?.model_credential_schema?.credential_form_schemas?.filter(
        ({ type }) => type === FormTypeEnum.secretInput,
      ) ?? []
    },
    [provider?.model_credential_schema?.credential_form_schemas, provider?.provider_credential_schema?.credential_form_schemas, providerFormSchemaPredefined],
  )

  const encodeConfigEntrySecretValues = useCallback((entry: ModelLoadBalancingConfigEntry) => {
    const result = { ...entry }
    extendedSecretFormSchemas.forEach(({ variable }) => {
      if (entry.id && result.credentials[variable] === originalConfigMap[entry.id]?.credentials?.[variable])
        result.credentials[variable] = '[__HIDDEN__]'
    })
    return result
  }, [extendedSecretFormSchemas, originalConfigMap])

  const { mutateAsync: updateModelLoadBalancingConfig } = useUpdateModelLoadBalancingConfig(provider.provider)
  const initialCustomModelCredential = useMemo(() => {
    if (!current_credential_id)
      return undefined
    return {
      credential_id: current_credential_id,
      credential_name: current_credential_name,
    }
  }, [current_credential_id, current_credential_name])
  const [customModelCredential, setCustomModelCredential] = useState<Credential | undefined>(initialCustomModelCredential)
  const { handleRefreshModel } = useRefreshModel()
  const handleSave = async () => {
    try {
      setLoading(true)
      const res = await updateModelLoadBalancingConfig(
        {
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
      )
      if (res.result === 'success') {
        notify({ type: 'success', message: t('actionMsg.modifiedSuccessfully', { ns: 'common' }) })
        handleRefreshModel(provider, currentCustomConfigurationModelFixedFields, false)
        onSave?.(provider.provider)
        onClose?.()
      }
    }
    finally {
      setLoading(false)
    }
  }
  const handleDeleteModel = useCallback(async () => {
    await handleConfirmDelete()
    onClose?.()
  }, [handleConfirmDelete, onClose])

  const handleUpdate = useCallback(async (payload?: any, formValues?: Record<string, any>) => {
    const result = await refetch()
    const available_credentials = result.data?.available_credentials || []
    const credentialName = formValues?.__authorization_name__
    const modelCredential = payload?.credential

    if (!available_credentials.length) {
      onClose?.()
      return
    }

    if (!modelCredential) {
      const currentCredential = available_credentials.find(c => c.credential_name === credentialName)
      if (currentCredential) {
        setDraftConfig((prev: any) => {
          if (!prev)
            return prev
          return {
            ...prev,
            configs: [...prev.configs, {
              credential_id: currentCredential.credential_id,
              enabled: true,
              name: currentCredential.credential_name,
            }],
          }
        })
      }
    }
    else {
      setDraftConfig((prev) => {
        if (!prev)
          return prev
        const newConfigs = [...prev.configs]
        const prevIndex = newConfigs.findIndex(item => item.credential_id === modelCredential.credential_id && item.name !== '__inherit__')
        const newIndex = available_credentials.findIndex(c => c.credential_id === modelCredential.credential_id)

        if (newIndex > -1 && prevIndex > -1)
          newConfigs[prevIndex].name = available_credentials[newIndex].credential_name || ''

        return {
          ...prev,
          configs: newConfigs,
        }
      })
    }
  }, [refetch, credential])

  const handleUpdateWhenSwitchCredential = useCallback(async () => {
    const result = await refetch()
    const available_credentials = result.data?.available_credentials || []
    if (!available_credentials.length)
      onClose?.()
  }, [refetch, onClose])

  return (
    <>
      <Modal
        isShow={Boolean(model) && open}
        onClose={onClose}
        className="w-[640px] max-w-none px-8 pt-8"
        title={(
          <div className="pb-3 font-semibold">
            <div className="h-[30px]">
              {
                draftConfig?.enabled
                  ? t('modelProvider.auth.configLoadBalancing', { ns: 'common' })
                  : t('modelProvider.auth.configModel', { ns: 'common' })
              }
            </div>
            {Boolean(model) && (
              <div className="flex h-5 items-center">
                <ModelIcon
                  className="mr-2 shrink-0"
                  provider={provider}
                  modelName={model!.model}
                />
                <ModelName
                  className="system-md-regular grow text-text-secondary"
                  modelItem={model!}
                  showModelType
                  showMode
                  showContextSize
                />
              </div>
            )}
          </div>
        )}
      >
        {!draftConfig
          ? <Loading type="area" />
          : (
              <>
                <div className="py-2">
                  <div
                    className={cn('min-h-16 rounded-xl border bg-components-panel-bg transition-colors', draftConfig.enabled ? 'cursor-pointer border-components-panel-border' : 'cursor-default border-util-colors-blue-blue-600')}
                    onClick={draftConfig.enabled ? () => toggleModalBalancing(false) : undefined}
                  >
                    <div className="flex select-none items-center gap-2 px-[15px] py-3">
                      <div className="flex h-8 w-8 shrink-0 grow-0 items-center justify-center rounded-lg border border-components-card-border bg-components-card-bg">
                        {Boolean(model) && (
                          <ModelIcon className="shrink-0" provider={provider} modelName={model!.model} />
                        )}
                      </div>
                      <div className="grow">
                        <div className="text-sm text-text-secondary">
                          {
                            providerFormSchemaPredefined
                              ? t('modelProvider.auth.providerManaged', { ns: 'common' })
                              : t('modelProvider.auth.specifyModelCredential', { ns: 'common' })
                          }
                        </div>
                        <div className="text-xs text-text-tertiary">
                          {
                            providerFormSchemaPredefined
                              ? t('modelProvider.auth.providerManagedTip', { ns: 'common' })
                              : t('modelProvider.auth.specifyModelCredentialTip', { ns: 'common' })
                          }
                        </div>
                      </div>
                      {
                        !providerFormSchemaPredefined && (
                          <SwitchCredentialInLoadBalancing
                            provider={provider}
                            customModelCredential={customModelCredential ?? initialCustomModelCredential}
                            setCustomModelCredential={setCustomModelCredential}
                            model={model}
                            credentials={available_credentials}
                            onUpdate={handleUpdateWhenSwitchCredential}
                            onRemove={handleUpdateWhenSwitchCredential}
                          />
                        )
                      }
                    </div>
                  </div>
                  {
                    modelCredential && (
                      <ModelLoadBalancingConfigs {...{
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
                        onRemove: handleUpdateWhenSwitchCredential,
                        model: {
                          model: model.model,
                          model_type: model.model_type,
                        },
                      }}
                      />
                    )
                  }
                </div>

                <div className="mt-6 flex items-center justify-between gap-2">
                  <div>
                    {
                      !providerFormSchemaPredefined && (
                        <Button
                          onClick={() => openConfirmDelete(undefined, { model: model.model, model_type: model.model_type })}
                          className="text-components-button-destructive-secondary-text"
                        >
                          {t('modelProvider.auth.removeModel', { ns: 'common' })}
                        </Button>
                      )
                    }
                  </div>
                  <div className="space-x-2">
                    <Button onClick={onClose}>{t('operation.cancel', { ns: 'common' })}</Button>
                    <Button
                      variant="primary"
                      onClick={handleSave}
                      disabled={
                        loading
                        || (draftConfig?.enabled && (draftConfig?.configs.filter(config => config.enabled).length ?? 0) < 2)
                        || isLoading
                      }
                    >
                      {t('operation.save', { ns: 'common' })}
                    </Button>
                  </div>
                </div>
              </>
            )}
      </Modal>
      {
        deleteModel && (
          <Confirm
            isShow
            title={t('modelProvider.confirmDelete', { ns: 'common' })}
            onCancel={closeConfirmDelete}
            onConfirm={handleDeleteModel}
            isDisabled={doingAction}
          />
        )
      }
    </>
  )
}

export default memo(ModelLoadBalancingModal)
