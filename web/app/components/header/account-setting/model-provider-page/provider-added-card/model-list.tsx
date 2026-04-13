import type { FC } from 'react'
import type {
  Credential,
  ModelItem,
  ModelProvider,
} from '../declarations'
import {
  RiArrowRightSLine,
} from '@remixicon/react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AddCustomModel,
  ManageCustomModelCredentials,
} from '@/app/components/header/account-setting/model-provider-page/model-auth'
import { useAppContext } from '@/context/app-context'
import { useModalContextSelector } from '@/context/modal-context'
import {
  ConfigurationMethodEnum,
} from '../declarations'
// import Tab from './tab'
import ModelListItem from './model-list-item'

type ModelListProps = {
  provider: ModelProvider
  models: ModelItem[]
  onCollapse: () => void
  onChange?: (provider: string) => void
}
const ModelList: FC<ModelListProps> = ({
  provider,
  models,
  onCollapse,
  onChange,
}) => {
  const { t } = useTranslation()
  const configurativeMethods = provider.configurate_methods.filter(method => method !== ConfigurationMethodEnum.fetchFromRemote)
  const { isCurrentWorkspaceManager } = useAppContext()
  const isConfigurable = configurativeMethods.includes(ConfigurationMethodEnum.customizableModel)
  const setShowModelLoadBalancingModal = useModalContextSelector(state => state.setShowModelLoadBalancingModal)
  const onModifyLoadBalancing = useCallback((model: ModelItem, credential?: Credential) => {
    setShowModelLoadBalancingModal({
      provider,
      credential,
      configurateMethod: model.fetch_from,
      model: model!,
      open: !!model,
      onClose: () => setShowModelLoadBalancingModal(null),
      onSave: onChange,
    })
  }, [onChange, provider, setShowModelLoadBalancingModal])

  return (
    <div className="rounded-b-xl px-2 pb-2">
      <div className="rounded-lg bg-components-panel-bg py-1">
        <div className="flex items-center pl-1 pr-[3px]">
          <span className="group mr-2 flex shrink-0 items-center">
            <span className="system-xs-medium inline-flex h-6 items-center pl-1 pr-1.5 text-text-tertiary group-hover:hidden">
              {t('modelProvider.modelsNum', { ns: 'common', num: models.length })}
              <RiArrowRightSLine className="mr-0.5 h-4 w-4 rotate-90" />
            </span>
            <span
              className="system-xs-medium hidden h-6 cursor-pointer items-center rounded-lg bg-state-base-hover pl-1 pr-1.5 text-text-tertiary group-hover:inline-flex"
              onClick={() => onCollapse()}
            >
              {t('modelProvider.modelsNum', { ns: 'common', num: models.length })}
              <RiArrowRightSLine className="mr-0.5 h-4 w-4 rotate-90" />
            </span>
          </span>
          {
            isConfigurable && isCurrentWorkspaceManager && (
              <div className="flex grow justify-end">
                <ManageCustomModelCredentials
                  provider={provider}
                  currentCustomConfigurationModelFixedFields={undefined}
                />
                <AddCustomModel
                  provider={provider}
                  configurationMethod={ConfigurationMethodEnum.customizableModel}
                  currentCustomConfigurationModelFixedFields={undefined}
                />
              </div>
            )
          }
        </div>
        {
          models.map(model => (
            <ModelListItem
              key={`${model.model}-${model.model_type}-${model.fetch_from}`}
              {...{
                model,
                provider,
                isConfigurable,
                onChange,
                onModifyLoadBalancing,
              }}
            />
          ))
        }
      </div>
    </div>
  )
}

export default ModelList
