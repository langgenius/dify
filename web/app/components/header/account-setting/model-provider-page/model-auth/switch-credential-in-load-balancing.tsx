import type { StatusDotStatus } from '@langgenius/dify-ui/status-dot'
import type { Dispatch, SetStateAction } from 'react'
import type {
  Credential,
  CustomModel,
  ModelProvider,
} from '../declarations'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { StatusDot } from '@langgenius/dify-ui/status-dot'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import {
  memo,
  useCallback,
} from 'react'
import { useTranslation } from 'react-i18next'
import Badge from '@/app/components/base/badge'
import { ConfigurationMethodEnum, ModelModalModeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { useCredentialPermissions } from '@/hooks/use-credential-permissions'
import Authorized from './authorized'

type SwitchCredentialInLoadBalancingProps = {
  provider: ModelProvider
  model: CustomModel
  credentials?: Credential[]
  customModelCredential?: Credential
  setCustomModelCredential: Dispatch<SetStateAction<Credential | undefined>>
  onUpdate?: (payload?: unknown, formValues?: Record<string, unknown>) => void
  onRemove?: (credentialId: string) => void
}
const SwitchCredentialInLoadBalancing = ({
  provider,
  model,
  customModelCredential,
  setCustomModelCredential,
  credentials,
  onUpdate,
  onRemove,
}: SwitchCredentialInLoadBalancingProps) => {
  const { t } = useTranslation()
  const notAllowCustomCredential = provider.allow_custom_token === false
  const { canUseCredential, canCreateCredential, canManageCredential } = useCredentialPermissions()
  const canOpenCredentialMenu = canUseCredential || canCreateCredential || canManageCredential
  const handleItemClick = useCallback((credential: Credential) => {
    if (!canUseCredential)
      return

    setCustomModelCredential(credential)
  }, [canUseCredential, setCustomModelCredential])

  const renderTrigger = useCallback(() => {
    const selectedCredentialId = customModelCredential?.credential_id
    const currentCredential = credentials?.find(c => c.credential_id === selectedCredentialId)
    const empty = !credentials?.length
    const authRemoved = selectedCredentialId && !currentCredential && !empty
    const unavailable = currentCredential?.not_allowed_to_use

    let color: StatusDotStatus = 'success'
    if (authRemoved || unavailable)
      color = 'error'

    const Item = (
      <Button
        variant="secondary"
        className={cn(
          'shrink-0 space-x-1',
          (authRemoved || unavailable) && 'text-components-button-destructive-secondary-text',
          (!canOpenCredentialMenu || (empty && !canCreateCredential)) && 'cursor-not-allowed opacity-50',
        )}
      >
        {
          !empty && (
            <StatusDot
              className="mr-2"
              status={color}
            />
          )
        }
        {
          authRemoved && t($ => $['modelProvider.auth.authRemoved'], { ns: 'common' })
        }
        {
          unavailable && t($ => $['auth.credentialUnavailableInButton'], { ns: 'plugin' })
        }
        {
          empty && canCreateCredential && !notAllowCustomCredential && t($ => $['modelProvider.auth.addCredential'], { ns: 'common' })
        }
        {
          empty && (!canCreateCredential || notAllowCustomCredential) && t($ => $['auth.credentialUnavailableInButton'], { ns: 'plugin' })
        }
        {
          !authRemoved && !unavailable && !empty && customModelCredential?.credential_name
        }
        {
          currentCredential?.from_enterprise && (
            <Badge className="ml-2">Enterprise</Badge>
          )
        }
        <span className="i-ri-arrow-down-s-line size-4" />
      </Button>
    )
    if ((empty && notAllowCustomCredential) || !canOpenCredentialMenu) {
      return (
        <Tooltip>
          <TooltipTrigger render={Item} />
          <TooltipContent>
            {t($ => $['auth.credentialUnavailable'], { ns: 'plugin' })}
          </TooltipContent>
        </Tooltip>
      )
    }
    return Item
  }, [canCreateCredential, canOpenCredentialMenu, customModelCredential, t, credentials, notAllowCustomCredential])

  return (
    <Authorized
      provider={provider}
      configurationMethod={ConfigurationMethodEnum.customizableModel}
      currentCustomConfigurationModelFixedFields={model
        ? {
            __model_name: model.model,
            __model_type: model.model_type,
          }
        : undefined}
      authParams={{
        isModelCredential: true,
        mode: ModelModalModeEnum.configModelCredential,
        onUpdate,
        onRemove,
      }}
      items={[
        {
          model,
          credentials: credentials || [],
          selectedCredential: customModelCredential
            ? {
                credential_id: customModelCredential?.credential_id || '',
                credential_name: customModelCredential?.credential_name || '',
              }
            : undefined,
        },
      ]}
      renderTrigger={renderTrigger}
      onItemClick={handleItemClick}
      enableAddModelCredential
      showItemSelectedIcon
      hideAddAction={!canCreateCredential}
      popupTitle={t($ => $['modelProvider.auth.modelCredentials'], { ns: 'common' })}
      triggerOnlyOpenModal={!credentials?.length && canCreateCredential}
    />
  )
}

export default memo(SwitchCredentialInLoadBalancing)
