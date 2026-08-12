import type { ModelProviderSummaryResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import type { ComponentType, FC } from 'react'
import type { Credential, ModelItem, ModelProvider } from '../declarations'
import type { ModelLoadBalancingModalProps } from './model-load-balancing-modal'
import { Dialog, DialogContent, DialogTitle } from '@langgenius/dify-ui/dialog'
import { toast } from '@langgenius/dify-ui/toast'
import { useAtomValue } from 'jotai'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { hasPermission } from '@/utils/permission'
import { ConfigurationMethodEnum } from '../declarations'
import { useLazyModelProviderDetail } from '../hooks'
import LazyCustomModelActions from './lazy-custom-model-actions'
// import Tab from './tab'
import ModelListItem from './model-list-item'

const ModelLoadBalancingLoadingDialog = ({
  onClose,
}: Pick<ModelLoadBalancingModalProps, 'onClose'>) => {
  const { t } = useTranslation()

  return (
    <Dialog open onOpenChange={(open) => !open && onClose?.()}>
      <DialogContent className="w-160 max-w-none border-none px-8 pt-8 text-left align-middle">
        <DialogTitle className="title-2xl-semi-bold text-text-primary">
          {t(($) => $['modelProvider.auth.configModel'], { ns: 'common' })}
        </DialogTitle>
        <div className="flex items-center gap-2 py-8" role="status" aria-busy="true">
          <span
            aria-hidden
            className="i-ri-loader-2-line size-4 animate-spin text-text-tertiary motion-reduce:animate-none"
          />
          <span className="system-sm-regular text-text-secondary">
            {t(($) => $.loading, { ns: 'common' })}
          </span>
        </div>
      </DialogContent>
    </Dialog>
  )
}

type ModelListProps = {
  provider: ModelProvider | ModelProviderSummaryResponse
  models: ModelItem[]
  onCollapse: () => void
  onChange?: (provider: string) => void
}

const getModelKey = (model: ModelItem) => `${model.model}-${model.model_type}-${model.fetch_from}`

let ModelLoadBalancingModal: ComponentType<ModelLoadBalancingModalProps> | undefined
let modelLoadBalancingModalPromise: Promise<void> | undefined

const loadModelLoadBalancingModal = () => {
  if (ModelLoadBalancingModal) return Promise.resolve()

  modelLoadBalancingModalPromise ??= import('./model-load-balancing-modal').then(
    ({ default: Modal }) => {
      ModelLoadBalancingModal = Modal
    },
  )

  return modelLoadBalancingModalPromise
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
  const [loadingModelKey, setLoadingModelKey] = useState<string | null>(null)
  const [isModelLoadBalancingModalLoading, setIsModelLoadBalancingModalLoading] = useState(false)
  const { loadProviderDetail } = useLazyModelProviderDetail(provider.provider)
  const onModifyLoadBalancing = useCallback(
    async (model: ModelItem, credential?: Credential) => {
      if (loadingModelKey) return

      let providerDetail: ModelProvider | undefined
      if ('is_configured' in provider) {
        setLoadingModelKey(getModelKey(model))
        try {
          providerDetail = await loadProviderDetail()
        } finally {
          setLoadingModelKey(null)
        }
      } else {
        providerDetail = provider
      }

      if (!providerDetail) {
        toast.error(t(($) => $['api.actionFailed'], { ns: 'common' }))
        return
      }

      setModelLoadBalancingModalProps({
        provider: providerDetail,
        credential,
        configurateMethod: model.fetch_from,
        model,
        open: true,
        onSave: onChange,
      })

      if (ModelLoadBalancingModal) return

      setIsModelLoadBalancingModalLoading(true)
      try {
        await loadModelLoadBalancingModal()
      } catch {
        setModelLoadBalancingModalProps(null)
        toast.error(t(($) => $['api.actionFailed'], { ns: 'common' }))
      } finally {
        setIsModelLoadBalancingModalLoading(false)
      }
    },
    [loadingModelKey, loadProviderDetail, onChange, provider, t],
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
              key={getModelKey(model)}
              {...{
                model,
                provider,
                isConfigurable,
                isLoadingLoadBalancing: loadingModelKey === getModelKey(model),
                isLoadBalancingDisabled:
                  loadingModelKey !== null && loadingModelKey !== getModelKey(model),
                onChange,
                onModifyLoadBalancing,
              }}
            />
          ))}
        </div>
      </div>
      {isModelLoadBalancingModalLoading && modelLoadBalancingModalProps && (
        <ModelLoadBalancingLoadingDialog onClose={() => setModelLoadBalancingModalProps(null)} />
      )}
      {ModelLoadBalancingModal && modelLoadBalancingModalProps && (
        <ModelLoadBalancingModal
          {...modelLoadBalancingModalProps}
          onClose={() => setModelLoadBalancingModalProps(null)}
        />
      )}
    </>
  )
}

export default ModelList
