import type { ModelProviderSummaryResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import type { FC } from 'react'
import type { Credential, ModelItem, ModelProvider } from '../declarations'
import { useQueryClient } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useModalContextSelector } from '@/context/modal-context'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { modelProviderDetailsQueryOptions } from '@/service/use-common'
import { hasPermission } from '@/utils/permission'
import { ConfigurationMethodEnum } from '../declarations'
import LazyCustomModelActions from './lazy-custom-model-actions'
// import Tab from './tab'
import ModelListItem from './model-list-item'

type ModelListProps = {
  provider: ModelProvider | ModelProviderSummaryResponse
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
  const setShowModelLoadBalancingModal = useModalContextSelector(
    (state) => state.setShowModelLoadBalancingModal,
  )
  const queryClient = useQueryClient()
  const onModifyLoadBalancing = useCallback(
    async (model: ModelItem, credential?: Credential) => {
      let providerDetail: ModelProvider | undefined
      if ('is_configured' in provider) {
        try {
          const response = await queryClient.ensureQueryData(modelProviderDetailsQueryOptions())
          providerDetail = response.data.find((item) => item.provider === provider.provider)
        } catch {
          return
        }
      } else {
        providerDetail = provider
      }
      if (!providerDetail) return
      setShowModelLoadBalancingModal({
        provider: providerDetail,
        credential,
        configurateMethod: model.fetch_from,
        model: model!,
        open: !!model,
        onClose: () => setShowModelLoadBalancingModal(null),
        onSave: onChange,
      })
    },
    [onChange, provider, queryClient, setShowModelLoadBalancingModal],
  )

  return (
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
              className="hidden h-6 cursor-pointer items-center rounded-lg border-none bg-state-base-hover pr-1.5 pl-1 system-xs-medium text-text-tertiary outline-hidden group-hover:inline-flex focus-visible:inline-flex focus-visible:ring-2 focus-visible:ring-state-accent-solid"
              onClick={() => onCollapse()}
            >
              {t(($) => $['modelProvider.modelsNum'], { ns: 'common', num: models.length })}
              <span className="mr-0.5 i-ri-arrow-right-s-line size-4 rotate-90" />
            </button>
          </span>
          {isConfigurable && canConfigureModels && (
            <div className="flex grow justify-end">
              <LazyCustomModelActions provider={provider} />
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
  )
}

export default ModelList
