'use client'

import type { AgentSoulAppFeaturesConfig } from '@dify/contracts/api/console/agent/types.gen'
import type { Features } from '@/app/components/base/features/types'
import type { ModerationConfig } from '@/models/debug'
import { Button } from '@langgenius/dify-ui/button'
import { Switch } from '@langgenius/dify-ui/switch'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { FeaturesProvider } from '@/app/components/base/features'
import { useFeatures, useFeaturesStore } from '@/app/components/base/features/hooks'
import { useLocale } from '@/context/i18n'
import { useModalContext } from '@/context/modal-context'
import { useAppFeatures, useSetAppFeatures } from '@/features/agent-v2/agent-composer/store-modules/app-features'
import { useCodeBasedExtensions } from '@/service/use-common'
import { ConfigureSection } from '../common/section'
import { useAgentOrchestrateReadOnly } from '../read-only-context'

const defaultModerationConfig: ModerationConfig = {
  enabled: true,
  type: 'openai_moderation',
  config: {
    inputs_config: {
      enabled: true,
      preset_response: '',
    },
  },
}

function AgentContentModerationSettingsContent() {
  const { t } = useTranslation()
  const locale = useLocale()
  const featuresStore = useFeaturesStore()
  const readOnly = useAgentOrchestrateReadOnly()
  const setAppFeatures = useSetAppFeatures()
  const { setShowModerationSettingModal } = useModalContext()
  const moderation = useFeatures(state => state.features.moderation)
  const { data: codeBasedExtensionList } = useCodeBasedExtensions('moderation')
  const panelId = 'agent-configure-content-moderation-panel'

  const persistModeration = useCallback((nextModeration?: ModerationConfig) => {
    if (!nextModeration)
      return

    const store = featuresStore?.getState()
    if (!store)
      return

    store.setFeatures({
      ...store.features,
      moderation: nextModeration,
    })
    setAppFeatures(appFeatures => ({
      ...appFeatures,
      sensitive_word_avoidance: nextModeration as AgentSoulAppFeaturesConfig['sensitive_word_avoidance'],
    }))
  }, [featuresStore, setAppFeatures])

  const openSettings = useCallback((payload: ModerationConfig = moderation as ModerationConfig) => {
    setShowModerationSettingModal({
      payload,
      onSaveCallback: persistModeration,
      onCancelCallback: () => {},
    })
  }, [moderation, persistModeration, setShowModerationSettingModal])

  const handleEnabledChange = useCallback((enabled: boolean) => {
    if (enabled) {
      if (!moderation?.type) {
        openSettings(defaultModerationConfig)
        return
      }

      persistModeration({
        ...(moderation as ModerationConfig),
        enabled: true,
      })
      return
    }

    persistModeration({ enabled: false })
  }, [moderation, openSettings, persistModeration])

  const providerContent = useMemo(() => {
    if (moderation?.type === 'openai_moderation')
      return t('feature.moderation.modal.provider.openai', { ns: 'appDebug' })
    if (moderation?.type === 'keywords')
      return t('feature.moderation.modal.provider.keywords', { ns: 'appDebug' })
    if (moderation?.type === 'api')
      return t('apiBasedExtension.selector.title', { ns: 'common' })

    return codeBasedExtensionList?.data.find(item => item.name === moderation?.type)?.label[locale] || '-'
  }, [codeBasedExtensionList?.data, locale, moderation?.type, t])

  const enabledContent = useMemo(() => {
    if (moderation?.config?.inputs_config?.enabled && moderation.config?.outputs_config?.enabled)
      return t('feature.moderation.allEnabled', { ns: 'appDebug' })
    if (moderation?.config?.inputs_config?.enabled)
      return t('feature.moderation.inputEnabled', { ns: 'appDebug' })
    if (moderation?.config?.outputs_config?.enabled)
      return t('feature.moderation.outputEnabled', { ns: 'appDebug' })

    return '-'
  }, [moderation?.config?.inputs_config?.enabled, moderation?.config?.outputs_config?.enabled, t])

  return (
    <ConfigureSection
      label={t('feature.moderation.title', { ns: 'appDebug' })}
      labelId="agent-configure-content-moderation-label"
      headingLevel="h4"
      panelId={panelId}
      rootClassName="gap-1 border-t border-divider-subtle py-3"
      headerClassName="mb-0 gap-1 px-3"
      panelContentClassName="px-3 pt-1"
      actions={!readOnly
        ? (
            <div className="flex shrink-0 items-center gap-2">
              {!!moderation?.enabled && (
                <Button
                  size="small"
                  variant="ghost"
                  className="h-6 gap-0.5 px-1.5 py-1 text-text-tertiary"
                  onClick={() => openSettings()}
                >
                  <span className="i-ri-equalizer-2-line size-3.5" aria-hidden />
                  <span className="px-0.5 system-xs-medium">
                    {t('operation.settings', { ns: 'common' })}
                  </span>
                </Button>
              )}
              <div className="h-3 w-px bg-divider-regular" />
              <Switch checked={!!moderation?.enabled} onCheckedChange={handleEnabledChange} size="sm" />
            </div>
          )
        : undefined}
    >
      {moderation?.enabled
        ? (
            <div className="flex min-w-0 items-center gap-4">
              <div className="min-w-0">
                <div className="mb-0.5 truncate system-2xs-medium-uppercase text-text-tertiary">
                  {t('feature.moderation.modal.provider.title', { ns: 'appDebug' })}
                </div>
                <div className="truncate system-xs-regular text-text-secondary">
                  {providerContent}
                </div>
              </div>
              <div className="h-[27px] w-px shrink-0 rotate-12 bg-divider-subtle" />
              <div className="min-w-0">
                <div className="mb-0.5 truncate system-2xs-medium-uppercase text-text-tertiary">
                  {t('feature.moderation.contentEnableLabel', { ns: 'appDebug' })}
                </div>
                <div className="truncate system-xs-regular text-text-secondary">
                  {enabledContent}
                </div>
              </div>
            </div>
          )
        : (
            <p className="system-xs-regular text-text-tertiary">
              {t('feature.moderation.description', { ns: 'appDebug' })}
            </p>
          )}
    </ConfigureSection>
  )
}

export function AgentContentModerationSettings() {
  const appFeatures = useAppFeatures()
  const moderation = appFeatures?.sensitive_word_avoidance
  const features = useMemo<Features>(() => ({
    moderation: moderation
      ? {
          ...moderation,
          type: moderation.type ?? undefined,
        }
      : { enabled: false },
  }), [moderation])
  const featuresKey = useMemo(() => JSON.stringify(moderation ?? {}), [moderation])

  return (
    <FeaturesProvider key={featuresKey} features={features}>
      <AgentContentModerationSettingsContent />
    </FeaturesProvider>
  )
}
