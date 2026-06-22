import type {
  Credential,
  CustomConfigurationModelFixedFields,
  CustomModelCredential,
  ModelCredential,
  ModelProvider,
} from '@/app/components/header/account-setting/model-provider-page/declarations'
import { cn } from '@langgenius/dify-ui/cn'
import {
  memo,
  useCallback,
} from 'react'
import { useTranslation } from 'react-i18next'
import { ConfigurationMethodEnum, ModelModalModeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { Authorized } from '@/app/components/header/account-setting/model-provider-page/model-auth'
import { useCredentialPermissions } from '@/hooks/use-credential-permissions'

type AddCredentialInLoadBalancingProps = {
  provider: ModelProvider
  model: CustomModelCredential
  configurationMethod: ConfigurationMethodEnum
  currentCustomConfigurationModelFixedFields?: CustomConfigurationModelFixedFields
  modelCredential: ModelCredential
  onSelectCredential: (credential: Credential) => void
  onUpdate?: (payload?: unknown, formValues?: Record<string, unknown>) => void
  onRemove?: (credentialId: string) => void
}
const AddCredentialInLoadBalancing = ({
  provider,
  model,
  configurationMethod,
  modelCredential,
  onSelectCredential,
  onUpdate,
  onRemove,
}: AddCredentialInLoadBalancingProps) => {
  const { t } = useTranslation()
  const { canUseCredential, canCreateCredential, canManageCredential } = useCredentialPermissions()
  const {
    available_credentials,
  } = modelCredential
  const canOpenCredentialMenu = canUseCredential || canCreateCredential || (canManageCredential && !!available_credentials?.length)
  const isCustomModel = configurationMethod === ConfigurationMethodEnum.customizableModel
  const notAllowCustomCredential = provider.allow_custom_token === false
  const handleUpdate = useCallback((payload?: unknown, formValues?: Record<string, unknown>) => {
    onUpdate?.(payload, formValues)
  }, [onUpdate])

  const renderTrigger = useCallback((open?: boolean) => {
    const Item = (
      <div className={cn(
        'flex h-8 items-center rounded-lg px-3 system-sm-medium text-text-accent hover:bg-state-base-hover',
        open && 'bg-state-base-hover',
      )}
      >
        <span className="mr-2 i-ri-add-line size-4" />
        {t('modelProvider.auth.addCredential', { ns: 'common' })}
      </div>
    )

    return Item
  }, [t])

  if (!canOpenCredentialMenu)
    return null

  return (
    <Authorized
      provider={provider}
      renderTrigger={renderTrigger}
      authParams={{
        isModelCredential: isCustomModel,
        mode: ModelModalModeEnum.configModelCredential,
        onUpdate: handleUpdate,
        onRemove,
      }}
      triggerOnlyOpenModal={!available_credentials?.length && !notAllowCustomCredential && canCreateCredential}
      items={[
        {
          title: isCustomModel ? '' : t('modelProvider.auth.apiKeys', { ns: 'common' }),
          model: isCustomModel ? model : undefined,
          credentials: available_credentials ?? [],
        },
      ]}
      showModelTitle={!isCustomModel}
      configurationMethod={configurationMethod}
      currentCustomConfigurationModelFixedFields={isCustomModel
        ? {
            __model_name: model.model,
            __model_type: model.model_type,
          }
        : undefined}
      onItemClick={onSelectCredential}
      hideAddAction={!canCreateCredential}
      placement="bottom-start"
      popupTitle={isCustomModel ? t('modelProvider.auth.modelCredentials', { ns: 'common' }) : ''}
    />
  )
}

export default memo(AddCredentialInLoadBalancing)
