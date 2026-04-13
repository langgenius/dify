import type {
  CustomConfigurationModelFixedFields,
  ModelProvider,
} from '@/app/components/header/account-setting/model-provider-page/declarations'
import {
  memo,
  useCallback,
} from 'react'
import { useTranslation } from 'react-i18next'
import {
  Button,
} from '@/app/components/base/button'
import {
  ConfigurationMethodEnum,
  ModelModalModeEnum,
} from '@/app/components/header/account-setting/model-provider-page/declarations'
import { cn } from '@/utils/classnames'
import Authorized from './authorized'
import {
  useCustomModels,
} from './hooks'

type ManageCustomModelCredentialsProps = {
  provider: ModelProvider
  currentCustomConfigurationModelFixedFields?: CustomConfigurationModelFixedFields
}
const ManageCustomModelCredentials = ({
  provider,
  currentCustomConfigurationModelFixedFields,
}: ManageCustomModelCredentialsProps) => {
  const { t } = useTranslation()
  const customModels = useCustomModels(provider)
  const noModels = !customModels.length

  const renderTrigger = useCallback((open?: boolean) => {
    const Item = (
      <Button
        variant="ghost"
        size="small"
        className={cn(
          'mr-0.5 text-text-tertiary',
          open && 'bg-components-button-ghost-bg-hover',
        )}
      >
        {t('modelProvider.auth.manageCredentials', { ns: 'common' })}
      </Button>
    )
    return Item
  }, [t])

  if (noModels)
    return null

  return (
    <Authorized
      provider={provider}
      configurationMethod={ConfigurationMethodEnum.customizableModel}
      currentCustomConfigurationModelFixedFields={currentCustomConfigurationModelFixedFields}
      items={customModels.map(model => ({
        model,
        credentials: model.available_model_credentials ?? [],
        selectedCredential: model.current_credential_id
          ? {
              credential_id: model.current_credential_id,
              credential_name: model.current_credential_name,
            }
          : undefined,
      }))}
      renderTrigger={renderTrigger}
      authParams={{
        isModelCredential: true,
        mode: ModelModalModeEnum.configModelCredential,
      }}
      hideAddAction
      disableItemClick
      popupTitle={t('modelProvider.auth.customModelCredentials', { ns: 'common' })}
      showModelTitle
      disableDeleteButShowAction
      disableDeleteTip={t('modelProvider.auth.customModelCredentialsDeleteTip', { ns: 'common' })}
    />
  )
}

export default memo(ManageCustomModelCredentials)
