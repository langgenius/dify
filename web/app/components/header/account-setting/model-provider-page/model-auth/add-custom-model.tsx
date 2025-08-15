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
  CustomModelCredential,
  ModelProvider,
} from '@/app/components/header/account-setting/model-provider-page/declarations'
import { ConfigurationMethodEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import Authorized from './authorized'
import { useAuth } from './hooks'
import cn from '@/utils/classnames'

type AddCustomModelProps = {
  provider: ModelProvider,
  configurationMethod: ConfigurationMethodEnum,
  currentCustomConfigurationModelFixedFields?: CustomConfigurationModelFixedFields,
  models: CustomModelCredential[]
}
const AddCustomModel = ({
  provider,
  configurationMethod,
  currentCustomConfigurationModelFixedFields,
  models,
}: AddCustomModelProps) => {
  const { t } = useTranslation()
  const noModels = !models.length
  const {
    handleOpenModal,
  } = useAuth(provider, configurationMethod, currentCustomConfigurationModelFixedFields)
  const handleClick = useCallback(() => {
    if (noModels)
      handleOpenModal()
  }, [handleOpenModal, noModels])
  const ButtonComponent = useMemo(() => {
    return (
      <Button
        variant='ghost-accent'
        size='small'
        onClick={handleClick}
        className={cn(noModels && 'text-text-accent')}
      >
        <RiAddCircleFill className='mr-1 h-3.5 w-3.5' />
        {t('common.modelProvider.addModel')}
      </Button>
    )
  }, [handleClick, noModels])

  const renderTrigger = useCallback(() => {
    return ButtonComponent
  }, [ButtonComponent])

  if (noModels)
    return ButtonComponent

  return (
    <Authorized
      provider={provider}
      configurationMethod={ConfigurationMethodEnum.customizableModel}
      items={models.map(model => ({
        model,
        credentials: model.available_model_credentials ?? [],
      }))}
      renderTrigger={renderTrigger}
    />
  )
}

export default memo(AddCustomModel)
