import type { Dispatch, SetStateAction } from 'react'
import type {
  Credential,
  CustomConfigurationModelFixedFields,
  CustomModelCredential,
  ModelCredential,
  ModelLoadBalancingConfig,
  ModelLoadBalancingConfigEntry,
  ModelProvider,
} from '../declarations'
import {
  RiIndeterminateCircleLine,
} from '@remixicon/react'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import Badge from '@/app/components/base/badge/index'
import GridMask from '@/app/components/base/grid-mask'
import { Balance } from '@/app/components/base/icons/src/vender/line/financeAndECommerce'
import { AlertTriangle } from '@/app/components/base/icons/src/vender/solid/alertsAndFeedback'
import Switch from '@/app/components/base/switch'
import Tooltip from '@/app/components/base/tooltip'
import UpgradeBtn from '@/app/components/billing/upgrade-btn'
import s from '@/app/components/custom/style.module.css'
import { AddCredentialInLoadBalancing } from '@/app/components/header/account-setting/model-provider-page/model-auth'
import { IS_CE_EDITION } from '@/config'
import { useProviderContextSelector } from '@/context/provider-context'
import { cn } from '@/utils/classnames'
import Indicator from '../../../indicator'
import { ConfigurationMethodEnum } from '../declarations'
import CooldownTimer from './cooldown-timer'

export type ModelLoadBalancingConfigsProps = {
  draftConfig?: ModelLoadBalancingConfig
  setDraftConfig: Dispatch<SetStateAction<ModelLoadBalancingConfig | undefined>>
  provider: ModelProvider
  configurationMethod: ConfigurationMethodEnum
  currentCustomConfigurationModelFixedFields?: CustomConfigurationModelFixedFields
  withSwitch?: boolean
  className?: string
  modelCredential: ModelCredential
  onUpdate?: (payload?: any, formValues?: Record<string, any>) => void
  onRemove?: (credentialId: string) => void
  model: CustomModelCredential
}

const ModelLoadBalancingConfigs = ({
  draftConfig,
  setDraftConfig,
  provider,
  model,
  configurationMethod,
  currentCustomConfigurationModelFixedFields: _currentCustomConfigurationModelFixedFields,
  withSwitch = false,
  className,
  modelCredential,
  onUpdate,
  onRemove,
}: ModelLoadBalancingConfigsProps) => {
  const { t } = useTranslation()
  const providerFormSchemaPredefined = configurationMethod === ConfigurationMethodEnum.predefinedModel
  const modelLoadBalancingEnabled = useProviderContextSelector(state => state.modelLoadBalancingEnabled)

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

  const addConfigEntry = useCallback((credential: Credential) => {
    setDraftConfig((prev: any) => {
      if (!prev)
        return prev
      return {
        ...prev,
        configs: [...prev.configs, {
          credential_id: credential.credential_id,
          enabled: true,
          name: credential.credential_name,
        }],
      }
    })
  }, [setDraftConfig])

  const toggleModalBalancing = useCallback((enabled: boolean) => {
    if ((modelLoadBalancingEnabled || !enabled) && draftConfig) {
      setDraftConfig({
        ...draftConfig,
        enabled,
      })
    }
  }, [draftConfig, modelLoadBalancingEnabled, setDraftConfig])

  const toggleConfigEntryEnabled = useCallback((index: number, state?: boolean) => {
    updateConfigEntry(index, entry => ({
      ...entry,
      enabled: typeof state === 'boolean' ? state : !entry.enabled,
    }))
  }, [updateConfigEntry])

  const clearCountdown = useCallback((index: number) => {
    updateConfigEntry(index, ({ ttl: _, ...entry }) => {
      return {
        ...entry,
        in_cooldown: false,
      }
    })
  }, [updateConfigEntry])

  const validDraftConfigList = useMemo(() => {
    if (!draftConfig)
      return []
    return draftConfig.configs
  }, [draftConfig])

  const handleUpdate = useCallback((payload?: any, formValues?: Record<string, any>) => {
    onUpdate?.(payload, formValues)
  }, [onUpdate])

  const handleRemove = useCallback((credentialId: string) => {
    const index = draftConfig?.configs.findIndex(item => item.credential_id === credentialId && item.name !== '__inherit__')
    if (index && index > -1)
      updateConfigEntry(index, () => undefined)
    onRemove?.(credentialId)
  }, [draftConfig?.configs, updateConfigEntry, onRemove])

  if (!draftConfig)
    return null

  return (
    <>
      <div
        className={cn('min-h-16 rounded-xl border bg-components-panel-bg transition-colors', (withSwitch || !draftConfig.enabled) ? 'border-components-panel-border' : 'border-util-colors-blue-blue-600', (withSwitch || draftConfig.enabled) ? 'cursor-default' : 'cursor-pointer', className)}
        onClick={(!withSwitch && !draftConfig.enabled) ? () => toggleModalBalancing(true) : undefined}
      >
        <div className="flex select-none items-center gap-2 px-[15px] py-3">
          <div className="flex h-8 w-8 shrink-0 grow-0 items-center justify-center rounded-lg border border-util-colors-indigo-indigo-100 bg-util-colors-indigo-indigo-50 text-util-colors-blue-blue-600">
            <Balance className="h-4 w-4" />
          </div>
          <div className="grow">
            <div className="flex items-center gap-1 text-sm text-text-primary">
              {t('modelProvider.loadBalancing', { ns: 'common' })}
              <Tooltip
                popupContent={t('modelProvider.loadBalancingInfo', { ns: 'common' })}
                popupClassName="max-w-[300px]"
                triggerClassName="w-3 h-3"
              />
            </div>
            <div className="text-xs text-text-tertiary">{t('modelProvider.loadBalancingDescription', { ns: 'common' })}</div>
          </div>
          {
            withSwitch && (
              <Switch
                defaultValue={Boolean(draftConfig.enabled)}
                size="l"
                className="ml-3 justify-self-end"
                disabled={!modelLoadBalancingEnabled && !draftConfig.enabled}
                onChange={value => toggleModalBalancing(value)}
              />
            )
          }
        </div>
        {draftConfig.enabled && (
          <div className="flex flex-col gap-1 px-3 pb-3">
            {validDraftConfigList.map((config, index) => {
              const isProviderManaged = config.name === '__inherit__'
              const credential = modelCredential.available_credentials.find(c => c.credential_id === config.credential_id)
              return (
                <div key={config.id || index} className="group flex h-10 items-center rounded-lg border border-components-panel-border bg-components-panel-on-panel-item-bg px-3 shadow-xs">
                  <div className="flex grow items-center">
                    <div className="mr-2 flex h-3 w-3 items-center justify-center">
                      {(config.in_cooldown && Boolean(config.ttl))
                        ? (
                            <CooldownTimer secondsRemaining={config.ttl} onFinish={() => clearCountdown(index)} />
                          )
                        : (
                            <Tooltip popupContent={t('modelProvider.apiKeyStatusNormal', { ns: 'common' })}>
                              <Indicator color={credential?.not_allowed_to_use ? 'gray' : 'green'} />
                            </Tooltip>
                          )}
                    </div>
                    <div className="mr-1 text-[13px] text-text-secondary">
                      {isProviderManaged ? t('modelProvider.defaultConfig', { ns: 'common' }) : config.name}
                    </div>
                    {isProviderManaged && providerFormSchemaPredefined && (
                      <Badge className="ml-2">{t('modelProvider.providerManaged', { ns: 'common' })}</Badge>
                    )}
                    {
                      credential?.from_enterprise && (
                        <Badge className="ml-2">Enterprise</Badge>
                      )
                    }
                  </div>
                  <div className="flex items-center gap-1">
                    {!isProviderManaged && (
                      <>
                        <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                          <Tooltip popupContent={t('operation.remove', { ns: 'common' })}>
                            <span
                              className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg bg-components-button-secondary-bg text-text-tertiary transition-colors hover:bg-components-button-secondary-bg-hover"
                              onClick={() => updateConfigEntry(index, () => undefined)}
                            >
                              <RiIndeterminateCircleLine className="h-4 w-4" />
                            </span>
                          </Tooltip>
                        </div>
                      </>
                    )}
                    {
                      (config.credential_id || config.name === '__inherit__') && (
                        <>
                          <span className="mr-2 h-3 border-r border-r-divider-subtle" />
                          <Switch
                            defaultValue={credential?.not_allowed_to_use ? false : Boolean(config.enabled)}
                            size="md"
                            className="justify-self-end"
                            onChange={value => toggleConfigEntryEnabled(index, value)}
                            disabled={credential?.not_allowed_to_use}
                          />
                        </>
                      )
                    }
                  </div>
                </div>
              )
            })}
            <AddCredentialInLoadBalancing
              provider={provider}
              model={model}
              configurationMethod={configurationMethod}
              modelCredential={modelCredential}
              onSelectCredential={addConfigEntry}
              onUpdate={handleUpdate}
              onRemove={handleRemove}
            />
          </div>
        )}
        {
          draftConfig.enabled && validDraftConfigList.length < 2 && (
            <div className="flex h-[34px] items-center rounded-b-xl border-t border-t-divider-subtle bg-components-panel-bg px-6 text-xs text-text-secondary">
              <AlertTriangle className="mr-1 h-3 w-3 text-[#f79009]" />
              {t('modelProvider.loadBalancingLeastKeyWarning', { ns: 'common' })}
            </div>
          )
        }
      </div>

      {!modelLoadBalancingEnabled && !IS_CE_EDITION && (
        <GridMask canvasClassName="!rounded-xl">
          <div className="mt-2 flex h-14 items-center justify-between rounded-xl border-[0.5px] border-components-panel-border px-4 shadow-md">
            <div
              className={cn('text-gradient text-sm font-semibold leading-tight', s.textGradient)}
            >
              {t('modelProvider.upgradeForLoadBalancing', { ns: 'common' })}
            </div>
            <UpgradeBtn />
          </div>
        </GridMask>
      )}
    </>
  )
}

export default ModelLoadBalancingConfigs
