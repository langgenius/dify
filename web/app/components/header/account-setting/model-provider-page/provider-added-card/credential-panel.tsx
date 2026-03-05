import type {
  ModelProvider,
  PreferredProviderTypeEnum,
} from '../declarations'
import type { CardVariant } from './use-credential-panel-state'
import { useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useToastContext } from '@/app/components/base/toast'
import Indicator from '@/app/components/header/indicator'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import { consoleQuery } from '@/service/client'
import { changeModelProviderPriority } from '@/service/common'
import {
  ConfigurationMethodEnum,
} from '../declarations'
import {
  useUpdateModelList,
  useUpdateModelProviders,
} from '../hooks'
import { UPDATE_MODEL_PROVIDER_CUSTOM_MODEL_LIST } from './index'
import ModelAuthDropdown from './model-auth-dropdown'
import SystemQuotaCard from './system-quota-card'
import { isDestructiveVariant, useCredentialPanelState } from './use-credential-panel-state'

type CredentialPanelProps = {
  provider: ModelProvider
}

const TEXT_LABEL_VARIANTS = new Set<CardVariant>([
  'credits-active',
  'credits-exhausted',
  'no-usage',
  'api-required-add',
  'api-required-configure',
])

const CredentialPanel = ({
  provider,
}: CredentialPanelProps) => {
  const { t } = useTranslation()
  const { notify } = useToastContext()
  const { eventEmitter } = useEventEmitterContextContext()
  const queryClient = useQueryClient()
  const updateModelList = useUpdateModelList()
  const updateModelProviders = useUpdateModelProviders()
  const state = useCredentialPanelState(provider)

  const handleChangePriority = useCallback(async (key: PreferredProviderTypeEnum) => {
    const res = await changeModelProviderPriority({
      url: `/workspaces/current/model-providers/${provider.provider}/preferred-provider-type`,
      body: { preferred_provider_type: key },
    })
    if (res.result === 'success') {
      notify({ type: 'success', message: t('actionMsg.modifiedSuccessfully', { ns: 'common' }) })
      queryClient.invalidateQueries({
        queryKey: consoleQuery.modelProviders.models.key(),
        refetchType: 'none',
      })
      updateModelProviders()
      provider.configurate_methods.forEach((method) => {
        if (method === ConfigurationMethodEnum.predefinedModel)
          provider.supported_model_types.forEach(modelType => updateModelList(modelType))
      })
      eventEmitter?.emit({
        type: UPDATE_MODEL_PROVIDER_CUSTOM_MODEL_LIST,
        payload: provider.provider,
      } as { type: string, payload: string })
    }
  }, [provider, notify, t, queryClient, updateModelProviders, updateModelList, eventEmitter])

  const { variant, credentialName } = state
  const isDestructive = isDestructiveVariant(variant)
  const isTextLabel = TEXT_LABEL_VARIANTS.has(variant)

  return (
    <SystemQuotaCard variant={isDestructive ? 'destructive' : 'default'}>
      <SystemQuotaCard.Label className={isTextLabel ? undefined : 'gap-1'}>
        {isTextLabel
          ? <TextLabel variant={variant} />
          : <StatusLabel variant={variant} credentialName={credentialName} />}
      </SystemQuotaCard.Label>
      <SystemQuotaCard.Actions>
        <ModelAuthDropdown
          provider={provider}
          state={state}
          onChangePriority={handleChangePriority}
        />
      </SystemQuotaCard.Actions>
    </SystemQuotaCard>
  )
}

function TextLabel({ variant }: { variant: CardVariant }) {
  const { t } = useTranslation()
  const isDestructive = isDestructiveVariant(variant)
  const labelKey = variant === 'credits-active'
    ? 'modelProvider.card.aiCreditsInUse'
    : variant === 'credits-exhausted'
      ? 'modelProvider.card.quotaExhausted'
      : variant === 'no-usage'
        ? 'modelProvider.card.noAvailableUsage'
        : 'modelProvider.card.apiKeyRequired'

  return (
    <span className={isDestructive ? 'text-text-destructive' : 'text-text-secondary'}>
      {t(labelKey, { ns: 'common' })}
    </span>
  )
}

function StatusLabel({ variant, credentialName }: {
  variant: CardVariant
  credentialName: string | undefined
}) {
  const { t } = useTranslation()
  const dotColor = variant === 'api-unavailable' ? 'red' : 'green'
  const showWarning = variant === 'api-fallback'

  return (
    <>
      <Indicator className="shrink-0" color={dotColor} />
      <span
        className="truncate text-text-secondary"
        title={credentialName}
      >
        {credentialName}
      </span>
      {showWarning && (
        <span className="i-ri-error-warning-fill h-3 w-3 shrink-0 text-text-warning" />
      )}
      {variant === 'api-unavailable' && (
        <span className="shrink-0 text-text-destructive system-2xs-medium">
          {t('modelProvider.card.unavailable', { ns: 'common' })}
        </span>
      )}
    </>
  )
}

export default CredentialPanel
