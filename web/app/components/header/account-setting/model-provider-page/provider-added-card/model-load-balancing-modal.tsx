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
      className='max-w-none pt-8 px-8 w-[640px]'
      title={
        <div className='pb-3 font-semibold'>
          <div className='h-[30px]'>{t('common.modelProvider.configLoadBalancing')}</div>
          {Boolean(model) && (
            <div className='flex items-center h-5'>
              <ModelIcon
                className='shrink-0 mr-2'
                provider={provider}
                modelName={model!.model}
              />
              <ModelName
                className='grow text-sm font-normal text-gray-900'
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
                  'min-h-16 bg-gray-50 border rounded-xl transition-colors',
                  draftConfig.enabled ? 'border-gray-200 cursor-pointer' : 'border-primary-400 cursor-default',
                )}
                onClick={draftConfig.enabled ? () => toggleModalBalancing(false) : undefined}
              >
                <div className='flex items-center px-[15px] py-3 gap-2 select-none'>
                  <div className='grow-0 shrink-0 flex items-center justify-center w-8 h-8 bg-white border rounded-lg'>
                    {Boolean(model) && (
                      <ModelIcon className='shrink-0' provider={provider} modelName={model!.model} />
                    )}
                  </div>
                  <div className='grow'>
                    <div className='text-sm'>{t('common.modelProvider.providerManaged')}</div>
                    <div className='text-xs text-gray-500'>{t('common.modelProvider.providerManagedDescription')}</div>
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

            <div className='flex items-center justify-end gap-2 mt-6'>
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
