import classNames from 'classnames'
import type { Dispatch, SetStateAction } from 'react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import type { ConfigurationMethodEnum, ModelLoadBalancingConfig, ModelLoadBalancingConfigEntry, ModelProvider } from '../declarations'
import Indicator from '../../../indicator'
import TooltipPlus from '@/app/components/base/tooltip-plus'
import Switch from '@/app/components/base/switch'
import SimplePieChart from '@/app/components/base/simple-pie-chart'
import { Balance } from '@/app/components/base/icons/src/vender/line/financeAndECommerce'
import { Edit02, HelpCircle, Plus02, Trash03 } from '@/app/components/base/icons/src/vender/line/general'
import { AlertTriangle } from '@/app/components/base/icons/src/vender/solid/alertsAndFeedback'
import { useModalContextSelector } from '@/context/modal-context'

export type ModelLoadBalancingConfigsProps = {
  draftConfig?: ModelLoadBalancingConfig
  setDraftConfig: Dispatch<SetStateAction<ModelLoadBalancingConfig | undefined>>
  provider: ModelProvider
  configurationMethod: ConfigurationMethodEnum
  withSwitch?: boolean
}

const ModelLoadBalancingConfigs = ({ draftConfig, setDraftConfig, provider, configurationMethod, withSwitch = false }: ModelLoadBalancingConfigsProps) => {
  const { t } = useTranslation()

  const updateConfigEntry = useCallback(
    (
      index: number,
      modifier: (entry: ModelLoadBalancingConfigEntry) => ModelLoadBalancingConfigEntry | undefined,
    ) => {
      setDraftConfig((prev) => {
        if (!prev)
          return prev
        const newConfigs = [...prev.configs]
        const modifiedConfig = modifier(newConfigs[index])
        if (modifiedConfig)
          newConfigs[index] = modifiedConfig
        else
          newConfigs.splice(index, 1)
        return {
          ...prev,
          configs: newConfigs,
        }
      })
    },
    [setDraftConfig],
  )

  const toggleModalBalancing = useCallback((enabled: boolean) => {
    if (draftConfig) {
      setDraftConfig({
        ...draftConfig,
        enabled,
      })
    }
  }, [draftConfig, setDraftConfig])

  const toggleConfigEntryEnabled = useCallback((index: number, state?: boolean) => {
    updateConfigEntry(index, entry => ({
      ...entry,
      enabled: typeof state === 'boolean' ? state : !entry.enabled,
    }))
  }, [updateConfigEntry])

  const setShowModelLoadBalancingEntryModal = useModalContextSelector(state => state.setShowModelLoadBalancingEntryModal)

  const toggleAddEntryModel = useCallback(() => {
    setShowModelLoadBalancingEntryModal({
      payload: {
        currentProvider: provider,
        currentConfigurationMethod: configurationMethod,
        currentCustomConfigurationModelFixedFields: undefined,
      },
      onSaveCallback: () => {
        // onRefreshData()
      },
    })
  }, [configurationMethod, provider, setShowModelLoadBalancingEntryModal])

  if (!draftConfig)
    return null

  return (
    <div
      className={classNames(
        'mt-2 min-h-16 bg-gray-50 border rounded-xl transition-colors',
        (withSwitch || !draftConfig.enabled) ? 'border-gray-200' : 'border-primary-400',
        (withSwitch || draftConfig.enabled) ? 'cursor-default' : 'cursor-pointer',
      )}
      onClick={(!withSwitch && !draftConfig.enabled) ? () => toggleModalBalancing(true) : undefined}
    >
      <div className='flex items-center px-[15px] py-3 gap-2 select-none'>
        <div className='grow-0 flex items-center justify-center w-8 h-8 text-primary-600 bg-indigo-50 border border-indigo-100 rounded-lg'>
          <Balance className='w-4 h-4' />
        </div>
        <div className='grow'>
          <div className='flex items-center gap-1 text-sm'>
            {t('common.modelProvider.loadBalancing')}
            <TooltipPlus popupContent={t('common.modelProvider.loadBalancingInfo')} popupClassName='max-w-[300px]'>
              <HelpCircle className='w-3 h-3 text-gray-400' />
            </TooltipPlus>
          </div>
          <div className='text-xs text-gray-500'>Todo</div>
        </div>
        {
          withSwitch && (
            <Switch
              defaultValue={Boolean(draftConfig.enabled)}
              size='md'
              className='ml-3 justify-self-end'
              onChange={value => toggleModalBalancing(value)}
            />
          )
        }
      </div>
      {draftConfig.enabled && (
        <div className='px-3 pb-3'>
          {draftConfig.configs.map((config, index) => {
            const isProviderManaged = config.name === '__inherit__'
            return (
              <div key={config.id || index} className='group flex items-center px-3 h-10 bg-white border border-gray-200 rounded-lg shadow-xs'>
                <div className='grow flex items-center'>
                  <div className='flex items-center justify-center mr-2 w-3 h-3'>
                    {(config.in_cooldown && Boolean(config.ttl))
                      ? (
                        <TooltipPlus popupContent={t('common.modelProvider.apiKeyRateLimit', { seconds: config.ttl })}>
                          <SimplePieChart percentage={Math.round(config.ttl / 60 * 100)} className='w-3 h-3' />
                        </TooltipPlus>
                      )
                      : (
                        <TooltipPlus popupContent={t('common.modelProvider.apiKeyStatusNormal')}>
                          <Indicator color='green' />
                        </TooltipPlus>
                      )}
                  </div>
                  <div className='text-[13px] mr-1'>
                    {isProviderManaged ? t('common.modelProvider.defaultConfig') : config.name}
                  </div>
                  {isProviderManaged && (
                    <span className='px-1 text-2xs uppercase text-gray-500 border border-black/8 rounded-[5px]'>{t('common.modelProvider.providerManaged')}</span>
                  )}
                </div>
                <div className='flex items-center gap-1'>
                  {!isProviderManaged && (
                    <>
                      <div className='flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100'>
                        <span className='flex items-center justify-center w-8 h-8 text-gray-500 bg-white rounded-lg transition-colors cursor-pointer hover:bg-black/5'>
                          <Edit02 className='w-4 h-4' />
                        </span>
                        <span
                          className='flex items-center justify-center w-8 h-8 text-gray-500 bg-white rounded-lg transition-colors cursor-pointer hover:bg-black/5'
                          onClick={() => updateConfigEntry(index, () => undefined)}
                        >
                          <Trash03 className='w-4 h-4' />
                        </span>
                        <span className='mr-2 h-3 border-r border-r-gray-100' />
                      </div>
                    </>
                  )}
                  <Switch
                    defaultValue={Boolean(config.enabled)}
                    size='md'
                    className='justify-self-end'
                    onChange={value => toggleConfigEntryEnabled(index, value)}
                  />
                </div>
              </div>
            )
          })}

          <div className='group flex items-center mt-1 px-3 h-10 bg-white border border-gray-200 rounded-lg shadow-xs'>
            <div className='grow flex items-center'>
              <div className='flex items-center justify-center mr-2 w-3 h-3'>
                <TooltipPlus popupContent={t('common.modelProvider.apiKeyRateLimit', { seconds: 60 })}>
                  <SimplePieChart percentage={80} className='w-3 h-3' />
                </TooltipPlus>
              </div>
              <div className='text-[13px] mr-1'>Another</div>
              <span className='px-1 text-2xs uppercase text-gray-500 border border-black/8 rounded-[5px]'>{t('common.modelProvider.providerManaged')}</span>
            </div>
            <div className='flex items-center gap-1'>
              <div className='flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100'>
                <span className='flex items-center justify-center w-8 h-8 text-gray-500 bg-white rounded-lg transition-colors cursor-pointer hover:bg-black/5'>
                  <Edit02 className='w-4 h-4' />
                </span>
                <span className='flex items-center justify-center w-8 h-8 text-gray-500 bg-white rounded-lg transition-colors cursor-pointer hover:bg-black/5'>
                  <Trash03 className='w-4 h-4' />
                </span>
                <span className='mr-2 h-3 border-r border-r-gray-100' />
              </div>
              <Switch
                defaultValue={false}
                size='md'
                className='justify-self-end'
                onChange={async value => value}
              />
            </div>
          </div>

          <div className='flex items-center px-3 mt-1 h-8 text-[13px] font-medium text-primary-600' onClick={toggleAddEntryModel}>
            <div className='flex items-center cursor-pointer'>
              <Plus02 className='mr-2 w-3 h-3' />{t('common.modelProvider.addConfig')}
            </div>
          </div>
        </div>
      )}
      {
        draftConfig.enabled && draftConfig.configs.length < 2 && (
          <div className='flex items-center px-6 h-[34px] text-xs text-gray-700 bg-black/2 border-t border-t-black/5'>
            <AlertTriangle className='mr-1 w-3 h-3 text-[#f79009]' />
            {t('common.modelProvider.loadBalancingLeastKeyWarning')}
          </div>
        )
      }
    </div>
  )
}

export default ModelLoadBalancingConfigs
