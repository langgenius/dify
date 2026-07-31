import type { FC } from 'react'
import type { Credential, ModelItem, ModelProvider } from '../declarations'
import type { ModelLoadBalancingModalProps } from './model-load-balancing-modal'
import { useAtomValue } from 'jotai'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AddCustomModel,
  ManageCustomModelCredentials,
} from '@/app/components/header/account-setting/model-provider-page/model-auth'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import dynamic from '@/next/dynamic'
import { hasPermission } from '@/utils/permission'
import { ConfigurationMethodEnum } from '../declarations'
// import Tab from './tab'
import ModelListItem from './model-list-item'

const ModelLoadBalancingModal = dynamic(() => import('./model-load-balancing-modal'), {
  ssr: false,
})

type ModelListProps = {
  provider: ModelProvider
  models: ModelItem[]
  onCollapse: () => void
  onChange?: (provider: string) => void
}
const ModelList: FC<ModelListProps> = ({ provider, models, onCollapse, onChange }) => {
  const { t } = useTranslation()
  const configurativeMethods = provider.configurate_methods.filter(
    (method) => method !== ConfigurationMethodEnum.fetchFromRemote,
  )
  const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)
  const canConfigureModels = hasPermission(workspacePermissionKeys, 'plugin.model_config')
  const isConfigurable = configurativeMethods.includes(ConfigurationMethodEnum.customizableModel)
  const [modelLoadBalancingModalProps, setModelLoadBalancingModalProps] =
    useState<ModelLoadBalancingModalProps | null>(null)
  const onModifyLoadBalancing = useCallback(
    (model: ModelItem, credential?: Credential) => {
      setModelLoadBalancingModalProps({
        provider,
        credential,
        configurateMethod: model.fetch_from,
        model,
        open: true,
      })
    },
    [provider],
  )

  return (
    <>
      <div className="rounded-b-xl px-2 pb-2">
        <div className="rounded-lg bg-components-panel-bg py-1">
          <div className="flex items-center pr-0.75 pl-1">
            <span className="group mr-2 flex shrink-0 items-center">
              <span className="inline-flex h-6 items-center pr-1.5 pl-1 system-xs-medium text-text-tertiary group-hover:hidden">
                {t(($) => $['modelProvider.modelsNum'], { ns: 'common', num: models.length })}
                <span className="mr-0.5 i-ri-arrow-right-s-line size-4 rotate-90" />
              </span>
              <button
                type="button"
                className="hidden h-6 cursor-pointer items-center rounded-lg border-none bg-state-base-hover pr-1.5 pl-1 system-xs-medium text-text-tertiary group-hover:inline-flex"
                onClick={() => onCollapse()}
              >
                {t(($) => $['modelProvider.modelsNum'], { ns: 'common', num: models.length })}
                <span className="mr-0.5 i-ri-arrow-right-s-line size-4 rotate-90" />
              </button>
            </span>
            {isConfigurable && canConfigureModels && (
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
            )}
          </div>
          {models.map((model) => (
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
          ))}
        </div>
      </div>
      {modelLoadBalancingModalProps && (
        <ModelLoadBalancingModal
          {...modelLoadBalancingModalProps}
          onClose={() => setModelLoadBalancingModalProps(null)}
          onSave={onChange}
        />
      )}
    </>
  )
}

export default ModelList
