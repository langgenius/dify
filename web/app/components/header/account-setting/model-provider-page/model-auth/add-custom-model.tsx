import {
  memo,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import {
  RiAddCircleFill,
  RiAddLine,
} from '@remixicon/react'
import {
  Button,
} from '@/app/components/base/button'
import type {
  ConfigurationMethodEnum,
  CustomConfigurationModelFixedFields,
  ModelProvider,
} from '@/app/components/header/account-setting/model-provider-page/declarations'
import { ModelModalModeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import cn from '@/utils/classnames'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import ModelIcon from '../model-icon'
import { useCanAddedModels } from './hooks/use-custom-models'
import { useAuth } from './hooks/use-auth'

type AddCustomModelProps = {
  provider: ModelProvider,
  configurationMethod: ConfigurationMethodEnum,
  currentCustomConfigurationModelFixedFields?: CustomConfigurationModelFixedFields,
  open?: boolean
  onOpenChange?: (open: boolean) => void
}
const AddCustomModel = ({
  provider,
  configurationMethod,
  currentCustomConfigurationModelFixedFields,
}: AddCustomModelProps) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const canAddedModels = useCanAddedModels(provider)
  const noModels = !canAddedModels.length
  const {
    handleOpenModal: handleOpenModalForAddNewCustomModel,
  } = useAuth(
    provider,
    configurationMethod,
    currentCustomConfigurationModelFixedFields,
    {
      isModelCredential: true,
      mode: ModelModalModeEnum.configCustomModel,
    },
  )
  const {
    handleOpenModal: handleOpenModalForAddCustomModelToModelList,
  } = useAuth(
    provider,
    configurationMethod,
    currentCustomConfigurationModelFixedFields,
    {
      isModelCredential: true,
      mode: ModelModalModeEnum.addCustomModelToModelList,
    },
  )

  return (
    <PortalToFollowElem
      open={open}
      onOpenChange={setOpen}
      placement='bottom-end'
      offset={{
        mainAxis: 4,
        crossAxis: -4,
      }}
    >
      <PortalToFollowElemTrigger onClick={() => {
        if (noModels) {
          handleOpenModalForAddNewCustomModel()
          return
        }

        setOpen(prev => !prev)
      }}>
        <Button
          variant='ghost'
          size='small'
          className={cn(
            'text-text-tertiary',
            open && 'bg-components-button-ghost-bg-hover',
          )}
        >
          <RiAddCircleFill className='mr-1 h-3.5 w-3.5' />
          {t('common.modelProvider.addModel')}
        </Button>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className='z-[100]'>
        <div className='w-[320px] rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur shadow-lg'>
          <div className='max-h-[304px] overflow-y-auto p-1'>
            {
              canAddedModels.map(model => (
                <div
                  key={model.model}
                  className='flex h-8 cursor-pointer items-center rounded-lg px-2 hover:bg-state-base-hover'
                  onClick={() => {
                    handleOpenModalForAddCustomModelToModelList(undefined, model)
                    setOpen(false)
                  }}
                >
                  <ModelIcon
                    className='mr-1 h-5 w-5 shrink-0'
                    iconClassName='h-5 w-5'
                    provider={provider}
                    modelName={model.model}
                  />
                  <div
                    className='system-md-regular grow truncate text-text-primary'
                    title={model.model}
                  >
                    {model.model}
                  </div>
                </div>
              ))
            }
          </div>
          <div
            className='system-xs-medium flex cursor-pointer items-center border-t border-t-divider-subtle p-3 text-text-accent-light-mode-only'
            onClick={() => {
              handleOpenModalForAddNewCustomModel()
              setOpen(false)
            }}
          >
            <RiAddLine className='mr-1 h-4 w-4' />
            {t('common.modelProvider.auth.addNewModel')}
          </div>
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}

export default memo(AddCustomModel)
