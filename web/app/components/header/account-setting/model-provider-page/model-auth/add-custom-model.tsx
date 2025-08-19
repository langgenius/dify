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
  const handleClick = useCallback(() => {
    handleOpenModal()
  }, [handleOpenModal])
  const ButtonComponent = useMemo(() => {
    return (
      <Button
        variant='ghost-accent'
        size='small'
        onClick={handleClick}
      >
        <RiAddCircleFill className='mr-1 h-3.5 w-3.5' />
        {t('common.modelProvider.addModel')}
      </Button>
    )
  }, [handleClick])

  const renderTrigger = useCallback((open?: boolean) => {
    return (
      <Button
        variant='ghost'
        size='small'
        className={cn(open && 'bg-components-button-ghost-bg-hover')}
      >
        <RiAddCircleFill className='mr-1 h-3.5 w-3.5' />
        {t('common.modelProvider.addModel')}
      </Button>
    )
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
