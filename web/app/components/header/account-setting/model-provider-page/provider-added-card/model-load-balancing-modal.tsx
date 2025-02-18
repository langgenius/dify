import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import useSWR from 'swr'
import type { ModelItem, ModelLoadBalancingConfig, ModelLoadBalancingConfigEntry, ModelProvider } from '../declarations'
import { FormTypeEnum } from '../declarations'
import ModelIcon from '../model-icon'
import ModelName from '../model-name'
import { savePredefinedLoadBalancingConfig } from '../utils'
import ModelLoadBalancingConfigs from './model-load-balancing-configs'
import classNames from '@/utils/classnames'
import Modal from '@/app/components/base/modal'
import Button from '@/app/components/base/button'
import { fetchModelLoadBalancingConfig } from '@/service/common'
import Loading from '@/app/components/base/loading'
import { useToastContext } from '@/app/components/base/toast'

export type ModelLoadBalancingModalProps = {
  provider: ModelProvider
  model: ModelItem
  open?: boolean
  onClose?: () => void
  onSave?: (provider: string) => void
}

// model balancing config modal
const ModelLoadBalancingModal = ({ provider, model, open = false, onClose, onSave }: ModelLoadBalancingModalProps) => {
  const { t } = useTranslation()
  const { notify } = useToastContext()

  const [loading, setLoading] = useState(false)

  const { data, mutate } = useSWR(
    `/workspaces/current/model-providers/${provider.provider}/models/credentials?model=${model.model}&model_type=${model.model_type}`,
    fetchModelLoadBalancingConfig,
  )

  const originalConfig = data?.load_balancing
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
    () => provider.provider_credential_schema.credential_form_schemas.filter(
      ({ type }) => type === FormTypeEnum.secretInput,
    ),
    [provider.provider_credential_schema.credential_form_schemas],
  )

  const encodeConfigEntrySecretValues = useCallback((entry: ModelLoadBalancingConfigEntry) => {
    const result = { ...entry }
    extendedSecretFormSchemas.forEach(({ variable }) => {
      if (entry.id && result.credentials[variable] === originalConfigMap[entry.id]?.credentials?.[variable])
        result.credentials[variable] = '[__HIDDEN__]'
    })
    return result
  }, [extendedSecretFormSchemas, originalConfigMap])

  const handleSave = async () => {
    try {
      setLoading(true)
      const res = await savePredefinedLoadBalancingConfig(
        provider.provider,
        ({
          ...(data?.credentials ?? {}),
          __model_type: model.model_type,
          __model_name: model.model,
        }),
        {
          ...draftConfig,
          enabled: Boolean(draftConfig?.enabled),
          configs: draftConfig!.configs.map(encodeConfigEntrySecretValues),
        },
      )
      if (res.result === 'success') {
        notify({ type: 'success', message: t('common.actionMsg.modifiedSuccessfully') })
        mutate()
        onSave?.(provider.provider)
        onClose?.()
      }
    }
    finally {
      setLoading(false)
    }
  }

  return (
    <Modal
      isShow={Boolean(model) && open}
      onClose={onClose}
      className='w-[640px] max-w-none px-8 pt-8'
      title={
        <div className='pb-3 font-semibold'>
          <div className='h-[30px]'>{t('common.modelProvider.configLoadBalancing')}</div>
          {Boolean(model) && (
            <div className='flex h-5 items-center'>
              <ModelIcon
                className='mr-2 shrink-0'
                provider={provider}
                modelName={model!.model}
              />
              <ModelName
                className='system-md-regular text-text-secondary grow'
                modelItem={model!}
                showModelType
                showMode
                showContextSize
              />
            </div>
          )}
        </div>
      }
    >
      {!draftConfig
        ? <Loading type='area' />
        : (
          <>
            <div className='py-2'>
              <div
                className={classNames(
                  'min-h-16 bg-components-panel-bg border rounded-xl transition-colors',
                  draftConfig.enabled ? 'border-components-panel-border cursor-pointer' : 'border-util-colors-blue-blue-600 cursor-default',
                )}
                onClick={draftConfig.enabled ? () => toggleModalBalancing(false) : undefined}
              >
                <div className='flex select-none items-center gap-2 px-[15px] py-3'>
                  <div className='bg-components-card-bg border-components-card-border flex h-8 w-8 shrink-0 grow-0 items-center justify-center rounded-lg border'>
                    {Boolean(model) && (
                      <ModelIcon className='shrink-0' provider={provider} modelName={model!.model} />
                    )}
                  </div>
                  <div className='grow'>
                    <div className='text-text-secondary text-sm'>{t('common.modelProvider.providerManaged')}</div>
                    <div className='text-text-tertiary text-xs'>{t('common.modelProvider.providerManagedDescription')}</div>
                  </div>
                </div>
              </div>

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
              }} />
            </div>

            <div className='mt-6 flex items-center justify-end gap-2'>
              <Button onClick={onClose}>{t('common.operation.cancel')}</Button>
              <Button
                variant='primary'
                onClick={handleSave}
                disabled={
                  loading
                  || (draftConfig?.enabled && (draftConfig?.configs.filter(config => config.enabled).length ?? 0) < 2)
                }
              >{t('common.operation.save')}</Button>
            </div>
          </>
        )
      }
    </Modal >
  )
}

export default memo(ModelLoadBalancingModal)
