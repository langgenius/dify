import type { ModelProviderSummaryResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import type { ComponentType, FC } from 'react'
import type { Credential, ModelItem, ModelProvider } from '../declarations'
import type { ModelLoadBalancingContentProps } from './model-load-balancing-modal'
import { Dialog, DialogClose, DialogContent, DialogTitle } from '@langgenius/dify-ui/dialog'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { useAtomValue } from 'jotai'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '@/app/notifications'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { hasPermission } from '@/utils/permission'
import { ConfigurationMethodEnum } from '../declarations'
import { useLazyModelProviderDetail } from '../hooks'
import LazyCustomModelActions from './lazy-custom-model-actions'
// import Tab from './tab'
import ModelListItem from './model-list-item'

type ModelListProps = {
  provider: ModelProvider | ModelProviderSummaryResponse
  models: ModelItem[]
  onCollapse: () => void
  onChange?: (provider: string) => void
}

const getModelKey = (model: ModelItem) => `${model.model}-${model.model_type}-${model.fetch_from}`

type ModelLoadBalancingSession = {
  input: Omit<ModelLoadBalancingContentProps, 'onClose'>
  open: boolean
  Content?: ComponentType<ModelLoadBalancingContentProps>
}

let ModelLoadBalancingContent: ComponentType<ModelLoadBalancingContentProps> | undefined
let modelLoadBalancingContentPromise:
  | Promise<ComponentType<ModelLoadBalancingContentProps>>
  | undefined

const loadModelLoadBalancingContent = () => {
  if (ModelLoadBalancingContent) return Promise.resolve(ModelLoadBalancingContent)

  modelLoadBalancingContentPromise ??= import('./model-load-balancing-modal').then(
    ({ ModelLoadBalancingContent: Content }) => {
      ModelLoadBalancingContent = Content
      return Content
    },
  )

  return modelLoadBalancingContentPromise
}

const ModelList: FC<ModelListProps> = ({ provider, models, onCollapse, onChange }) => {
  const { t } = useTranslation(['common', 'modelProvider'])
  const configurativeMethods = provider.configurate_methods.filter(
    (method) => method !== ConfigurationMethodEnum.fetchFromRemote,
  )
  const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)
  const canConfigureModels = hasPermission(workspacePermissionKeys, 'plugin.model_config')
  const isConfigurable = configurativeMethods.includes(ConfigurationMethodEnum.customizableModel)
  const [session, setSession] = useState<ModelLoadBalancingSession | null>(null)
  const [loadingModelKey, setLoadingModelKey] = useState<string | null>(null)
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

      const openingSession: ModelLoadBalancingSession = {
        input: {
          provider: providerDetail,
          credential,
          configurateMethod: model.fetch_from,
          model,
          onSave: onChange,
        },
        open: true,
        Content: ModelLoadBalancingContent,
      }
      setSession(openingSession)

      if (ModelLoadBalancingContent) return

      try {
        const Content = await loadModelLoadBalancingContent()
        setSession((current) => (current === openingSession ? { ...current, Content } : current))
      } catch {
        setSession((current) =>
          current === openingSession ? { ...current, open: false } : current,
        )
        toast.error(t(($) => $['api.actionFailed'], { ns: 'common' }))
      }
    },
    [loadingModelKey, loadProviderDetail, onChange, provider, t],
  )

  const Content = session?.Content
  const handleOpenChange = (open: boolean) => {
    setSession((current) => (current ? { ...current, open } : current))
  }

  return (
    <>
      <div className="rounded-b-xl px-2 pb-2">
        <div className="rounded-lg bg-components-panel-bg py-1">
          <div className="flex items-center pr-0.75 pl-1">
            <span className="mr-2 flex shrink-0 items-center">
              <button
                type="button"
                className="inline-flex h-6 cursor-pointer items-center rounded-lg border-none bg-transparent pr-1.5 pl-1 system-xs-medium text-text-tertiary outline-hidden hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid"
                aria-expanded="true"
                onClick={() => onCollapse()}
              >
                {t(($) => $['modelProvider.modelsNum'], {
                  ns: 'modelProvider',
                  num: models.length,
                })}
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
      {session && (
        <Dialog open={session.open} onOpenChange={handleOpenChange}>
          <DialogContent className="w-160 border-none px-8 pt-8 text-left align-middle">
            <DialogClose
              render={
                <IconButton
                  className="absolute top-4 right-4"
                  aria-label={t(($) => $['operation.close'], { ns: 'common' })}
                >
                  <span aria-hidden className="i-ri-close-line size-4" />
                </IconButton>
              }
            />
            {Content ? (
              <Content {...session.input} onClose={() => handleOpenChange(false)} />
            ) : (
              <>
                <DialogTitle className="title-2xl-semi-bold text-text-primary">
                  {t(($) => $['modelProvider.auth.configModel'], { ns: 'modelProvider' })}
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
              </>
            )}
          </DialogContent>
        </Dialog>
      )}
    </>
  )
}

export default ModelList
