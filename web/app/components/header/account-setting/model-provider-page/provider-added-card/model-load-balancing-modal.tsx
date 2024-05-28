import { memo, useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import classNames from 'classnames'
import useSWR from 'swr'
import type { ModelItem, ModelLoadBalancingConfig, ModelProvider } from '../declarations'
import ModelIcon from '../model-icon'
import ModelName from '../model-name'
import ModelLoadBalancingConfigs from './model-load-balancing-configs'
import Modal from '@/app/components/base/modal'
import Button from '@/app/components/base/button'
import { fetchModelLoadBalancingConfig } from '@/service/common'
import Loading from '@/app/components/base/loading'

export type ModelLoadBalancingModalProps = {
  provider: ModelProvider
  model: ModelItem
  open?: boolean
  onClose?: () => void
}

// model balancing config modal
const ModelLoadBalancingModal = ({ provider, model, open = false, onClose }: ModelLoadBalancingModalProps) => {
  const { t } = useTranslation()

  // useProviderCredentialsFormSchemasValue(provider.provider, model.fetch_from)
  const { data } = useSWR(
    `/workspaces/current/model-providers/${provider.provider}/models/credentials?model=${model.model}&model_type=${model.model_type}`,
    fetchModelLoadBalancingConfig,
  )

  const originalConfig = data?.load_balancing
  const [draftConfig, setDraftConfig] = useState<ModelLoadBalancingConfig>()
  useEffect(() => {
    if (originalConfig && !draftConfig)
      setDraftConfig(originalConfig)
  }, [draftConfig, originalConfig])

  const toggleModalBalancing = useCallback((enabled: boolean) => {
    if (draftConfig) {
      setDraftConfig({
        ...draftConfig,
        enabled,
      })
    }
  }, [draftConfig])

  return (
    <Modal
      isShow={Boolean(model) && open}
      onClose={onClose}
      wrapperClassName='!z-30'
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
                  <div className='grow-0 flex items-center justify-center w-8 h-8 bg-white border rounded-lg'>
                    {Boolean(model) && (
                      <ModelIcon className='shrink-0' provider={provider} modelName={model!.model} />
                    )}
                  </div>
                  <div className='grow'>
                    <div className='text-sm'>{t('common.modelProvider.providerManaged')}</div>
                    <div className='text-xs text-gray-500'>Todo</div>
                  </div>
                </div>
              </div>

              <ModelLoadBalancingConfigs {...{
                draftConfig,
                setDraftConfig,
                provider,
                configurationMethod: model.fetch_from,
              }} />
            </div>

            <div className='flex items-center justify-end gap-2 mt-6'>
              <Button onClick={onClose}>{t('common.operation.cancel')}</Button>
              <Button type='primary'>{t('common.operation.save')}</Button>
            </div>
          </>
        )
      }
    </Modal >
  )
}

export default memo(ModelLoadBalancingModal)
