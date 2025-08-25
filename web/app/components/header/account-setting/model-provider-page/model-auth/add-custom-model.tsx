import {
  memo,
  useCallback,
  useMemo,
} from 'react'
import { useTranslation } from 'react-i18next'
import {
  RiAddCircleFill,
} from '@remixicon/react'
import {
  Button,
} from '@/app/components/base/button'
import type {
  CustomConfigurationModelFixedFields,
  ModelProvider,
} from '@/app/components/header/account-setting/model-provider-page/declarations'
import { ConfigurationMethodEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import Authorized from './authorized'
import {
  useAuth,
  useCustomModels,
} from './hooks'
import cn from '@/utils/classnames'
import Tooltip from '@/app/components/base/tooltip'

type AddCustomModelProps = {
  provider: ModelProvider,
  configurationMethod: ConfigurationMethodEnum,
  currentCustomConfigurationModelFixedFields?: CustomConfigurationModelFixedFields,
}
const AddCustomModel = ({
  provider,
  configurationMethod,
  currentCustomConfigurationModelFixedFields,
}: AddCustomModelProps) => {
  const { t } = useTranslation()
  const customModels = useCustomModels(provider)
  const noModels = !customModels.length
  const {
    handleOpenModal,
  } = useAuth(provider, configurationMethod, currentCustomConfigurationModelFixedFields, true)
  const notAllowCustomCredential = provider.allow_custom_token === false
  const handleClick = useCallback(() => {
    if (notAllowCustomCredential)
      return

    handleOpenModal()
  }, [handleOpenModal, notAllowCustomCredential])
  const ButtonComponent = useMemo(() => {
    const Item = (
      <Button
        variant='ghost-accent'
        size='small'
        onClick={handleClick}
        className={cn(
          notAllowCustomCredential && 'cursor-not-allowed opacity-50',
        )}
      >
        <RiAddCircleFill className='mr-1 h-3.5 w-3.5' />
        {t('common.modelProvider.addModel')}
      </Button>
    )
    if (notAllowCustomCredential) {
      return (
        <Tooltip
          asChild
          popupContent={t('plugin.auth.credentialUnavailable')}
        >
          {Item}
        </Tooltip>
      )
    }
    return Item
  }, [handleClick, notAllowCustomCredential, t])

  const renderTrigger = useCallback((open?: boolean) => {
    const Item = (
      <Button
        variant='ghost'
        size='small'
        className={cn(
          open && 'bg-components-button-ghost-bg-hover',
        )}
      >
        <RiAddCircleFill className='mr-1 h-3.5 w-3.5' />
        {t('common.modelProvider.addModel')}
      </Button>
    )
    return Item
  }, [t])

  if (noModels)
    return ButtonComponent

  return (
    <Authorized
      provider={provider}
      configurationMethod={ConfigurationMethodEnum.customizableModel}
      items={customModels.map(model => ({
        model,
        credentials: model.available_model_credentials ?? [],
      }))}
      renderTrigger={renderTrigger}
      isModelCredential
      enableAddModelCredential
      bottomAddModelCredentialText={t('common.modelProvider.auth.addNewModel')}
    />
  )
}

export default memo(AddCustomModel)
