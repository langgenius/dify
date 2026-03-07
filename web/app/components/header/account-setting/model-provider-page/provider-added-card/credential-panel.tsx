import type {
  ModelProvider,
  PreferredProviderTypeEnum,
} from '../declarations'
import type { CardVariant } from './use-credential-panel-state'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import Warning from '@/app/components/base/icons/src/vender/line/alertsAndFeedback/Warning'
import Toast from '@/app/components/base/toast'
import Indicator from '@/app/components/header/indicator'
import { consoleQuery } from '@/service/client'
import {
  ConfigurationMethodEnum,
} from '../declarations'
import {
  useUpdateModelList,
  useUpdateModelProviders,
} from '../hooks'
import ModelAuthDropdown from './model-auth-dropdown'
import SystemQuotaCard from './system-quota-card'
import { isDestructiveVariant, useCredentialPanelState } from './use-credential-panel-state'

type CredentialPanelProps = {
  provider: ModelProvider
}

const TEXT_LABEL_VARIANTS = new Set<CardVariant>([
  'credits-active',
  'credits-fallback',
  'credits-exhausted',
  'no-usage',
  'api-required-add',
  'api-required-configure',
])

const CredentialPanel = ({
  provider,
}: CredentialPanelProps) => {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const updateModelList = useUpdateModelList()
  const updateModelProviders = useUpdateModelProviders()
  const state = useCredentialPanelState(provider)
  const providerName = provider.provider
  const modelProviderModelListQueryKey = consoleQuery.modelProviders.models.queryKey({
    input: {
      params: {
        provider: providerName,
      },
    },
  })

  const { mutate: changePriority, isPending: isChangingPriority } = useMutation(
    consoleQuery.modelProviders.changePreferredProviderType.mutationOptions({
      onSuccess: () => {
        Toast.notify({ type: 'success', message: t('actionMsg.modifiedSuccessfully', { ns: 'common' }) })
        queryClient.invalidateQueries({
          queryKey: modelProviderModelListQueryKey,
          exact: true,
          refetchType: 'none',
        })
        updateModelProviders()
        provider.configurate_methods.forEach((method) => {
          if (method === ConfigurationMethodEnum.predefinedModel)
            provider.supported_model_types.forEach(modelType => updateModelList(modelType))
        })
      },
      onError: () => {
        Toast.notify({ type: 'error', message: t('actionMsg.modifiedUnsuccessfully', { ns: 'common' }) })
      },
    }),
  )

  const handleChangePriority = (key: PreferredProviderTypeEnum) => {
    changePriority({
      params: { provider: providerName },
      body: { preferred_provider_type: key },
    })
  }

  const { variant, credentialName } = state
  const isDestructive = isDestructiveVariant(variant)
  const isTextLabel = TEXT_LABEL_VARIANTS.has(variant)
  const needsGap = !isTextLabel || variant === 'credits-fallback'

  return (
    <SystemQuotaCard variant={isDestructive ? 'destructive' : 'default'}>
      <SystemQuotaCard.Label className={needsGap ? 'gap-1' : undefined}>
        {isTextLabel
          ? <TextLabel variant={variant} />
          : <StatusLabel variant={variant} credentialName={credentialName} />}
      </SystemQuotaCard.Label>
      <SystemQuotaCard.Actions>
        <ModelAuthDropdown
          provider={provider}
          state={state}
          isChangingPriority={isChangingPriority}
          onChangePriority={handleChangePriority}
        />
      </SystemQuotaCard.Actions>
    </SystemQuotaCard>
  )
}

const TEXT_LABEL_KEYS = {
  'credits-active': 'modelProvider.card.aiCreditsInUse',
  'credits-fallback': 'modelProvider.card.aiCreditsInUse',
  'credits-exhausted': 'modelProvider.card.quotaExhausted',
  'no-usage': 'modelProvider.card.noAvailableUsage',
  'api-required-add': 'modelProvider.card.apiKeyRequired',
  'api-required-configure': 'modelProvider.card.apiKeyRequired',
} as const satisfies Partial<Record<CardVariant, string>>

function TextLabel({ variant }: { variant: CardVariant }) {
  const { t } = useTranslation()
  const isDestructive = isDestructiveVariant(variant)
  const labelKey = TEXT_LABEL_KEYS[variant as keyof typeof TEXT_LABEL_KEYS]

  return (
    <>
      <span className={isDestructive ? 'text-text-destructive' : 'text-text-secondary'}>
        {t(labelKey, { ns: 'common' })}
      </span>
      {variant === 'credits-fallback' && (
        <Warning className="h-3 w-3 shrink-0 text-text-warning" />
      )}
    </>
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
        <Warning className="h-3 w-3 shrink-0 text-text-warning" />
      )}
      {variant === 'api-unavailable' && (
        <span className="shrink-0 text-text-destructive system-2xs-medium">
          {t('modelProvider.card.unavailable', { ns: 'common' })}
        </span>
      )}
    </>
  )
}

export default memo(CredentialPanel)
