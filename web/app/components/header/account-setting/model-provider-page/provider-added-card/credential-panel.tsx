import type { ReactNode } from 'react'
import type { ModelProvider, PreferredProviderTypeEnum } from '../declarations'
import type { CardVariant } from './use-credential-panel-state'
import { StatusDot } from '@langgenius/dify-ui/status-dot'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import Warning from '@/app/components/base/icons/src/vender/line/alertsAndFeedback/Warning'
import ModelAuthDropdown from './model-auth-dropdown'
import SystemQuotaCard from './system-quota-card'
import { useChangeProviderPriority } from './use-change-provider-priority'
import { isDestructiveVariant, useCredentialPanelState } from './use-credential-panel-state'

type CredentialPanelProps = {
  provider: ModelProvider
}

type CredentialPanelContentProps = {
  provider: ModelProvider
  state: ReturnType<typeof useCredentialPanelState>
  isChangingPriority: boolean
  onChangePriority: (key: PreferredProviderTypeEnum) => void
  renderActions?: (props: {
    provider: ModelProvider
    state: ReturnType<typeof useCredentialPanelState>
    isChangingPriority: boolean
    onChangePriority: (key: PreferredProviderTypeEnum) => void
  }) => ReactNode
}

const TEXT_LABEL_VARIANTS = new Set<CardVariant>([
  'credits-active',
  'credits-fallback',
  'credits-exhausted',
  'no-usage',
  'api-required-add',
  'api-required-configure',
])

const CredentialPanelContent = ({
  provider,
  state,
  isChangingPriority,
  onChangePriority,
  renderActions,
}: CredentialPanelContentProps) => {
  const { variant, credentialName } = state
  const isDestructive = isDestructiveVariant(variant)
  const isTextLabel = TEXT_LABEL_VARIANTS.has(variant)
  const needsGap = !isTextLabel || variant === 'credits-fallback'

  return (
    <SystemQuotaCard variant={isDestructive ? 'destructive' : 'default'}>
      <SystemQuotaCard.Label className={needsGap ? 'gap-1' : undefined}>
        {isTextLabel
          ? <TextLabel variant={variant} />
          : <CredentialStatus variant={variant} credentialName={credentialName} />}
      </SystemQuotaCard.Label>
      <SystemQuotaCard.Actions>
        {renderActions
          ? renderActions({ provider, state, isChangingPriority, onChangePriority })
          : (
              <ModelAuthDropdown
                provider={provider}
                state={state}
                isChangingPriority={isChangingPriority}
                onChangePriority={onChangePriority}
              />
            )}
      </SystemQuotaCard.Actions>
    </SystemQuotaCard>
  )
}

const CredentialPanel = ({
  provider,
}: CredentialPanelProps) => {
  // eslint-disable-next-line react/use-state -- This is a domain hook, not React's useState.
  const credentialPanelInfo = useCredentialPanelState(provider)
  const { isChangingPriority, handleChangePriority } = useChangeProviderPriority(provider)

  return (
    <CredentialPanelContent
      provider={provider}
      state={credentialPanelInfo}
      isChangingPriority={isChangingPriority}
      onChangePriority={handleChangePriority}
    />
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
        <Warning className="size-3 shrink-0 text-text-warning" />
      )}
    </>
  )
}

function CredentialStatus({ variant, credentialName }: {
  variant: CardVariant
  credentialName: string | undefined
}) {
  const isDestructive = isDestructiveVariant(variant)
  const dotColor = isDestructive ? 'error' : 'success'
  const showWarning = variant === 'api-fallback'

  return (
    <>
      <StatusDot className="shrink-0" size="small" status={dotColor} />
      <span
        className={`truncate ${isDestructive ? 'text-text-destructive' : 'text-text-secondary'}`}
        title={credentialName}
      >
        {credentialName}
      </span>
      {showWarning && (
        <Warning className="ml-auto size-3 shrink-0 text-text-warning" />
      )}
    </>
  )
}

export default memo(CredentialPanel)
