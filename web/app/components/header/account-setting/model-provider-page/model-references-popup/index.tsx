import type { FC } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  RiArrowRightSLine,
  RiCloseLine,
  RiExternalLinkFill,
  RiNodeTree,
} from '@remixicon/react'
import Modal from '@/app/components/base/modal'
import { useModelProviderReferences } from '@/service/use-models'
import type { ModelReference } from '@/service/use-models'
import cn from '@/utils/classnames'

type ModelReferencesPopupProps = {
  isOpen: boolean
  onClose: () => void
  provider: string
  providerName: string
}

const ModelReferencesPopup: FC<ModelReferencesPopupProps> = ({
  isOpen,
  onClose,
  provider,
  providerName,
}) => {
  const { t } = useTranslation()
  const { data: referencesData, isLoading } = useModelProviderReferences(provider, isOpen)
  const [collapsedModels, setCollapsedModels] = useState<Set<string>>(new Set())

  const handleWorkflowClick = (appId: string) => {
    window.open(`/app/${appId}/overview`, '_blank')
  }

  const toggleModelCollapse = (modelKey: string) => {
    setCollapsedModels((prev) => {
      const newSet = new Set(prev)
      if (newSet.has(modelKey))
        newSet.delete(modelKey)
      else
        newSet.add(modelKey)
      return newSet
    })
  }

  const references = referencesData?.data

  return (
    <Modal
      isShow={isOpen}
      onClose={onClose}
      className="!max-w-2xl"
      title={
        <div className="flex items-center gap-2">
          <RiNodeTree className="h-5 w-5 text-text-primary" />
          <span>{t('common.modelProvider.modelReferences')}</span>
          <span className="text-text-tertiary">({providerName})</span>
        </div>
      }
    >
      <div className="px-6 pb-6">
        {isLoading && (
          <div className="flex items-center justify-center py-8">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-components-button-primary-bg border-t-transparent" />
          </div>
        )}

        {!isLoading && (!references?.models?.length) && (
          <div className="py-8 text-center">
            <RiNodeTree className="mx-auto mb-3 h-12 w-12 text-text-quaternary" />
            <div className="text-sm text-text-secondary">
              {t('common.modelProvider.noModelReferences')}
            </div>
          </div>
        )}

        {!isLoading && references?.models && references.models.length > 0 && (
          <div className="space-y-4">
            <div className="flex items-center justify-between border-b border-divider-subtle pb-2 text-xs text-text-tertiary">
              <span>
                {t('common.modelProvider.totalModelsUsed', { count: references.total_models })}
              </span>
              <span>
                {t('common.modelProvider.totalWorkflows', { count: references.total_workflows })}
              </span>
            </div>

            <div className="max-h-96 space-y-3 overflow-y-auto">
              {references.models.map((model: ModelReference, index: number) => {
                const modelKey = `${model.model_name}-${model.model_mode}-${index}`
                const isCollapsed = collapsedModels.has(modelKey)

                return (
                  <div
                    key={modelKey}
                    className="rounded-lg border border-divider-subtle p-4"
                  >
                    <div
                      className="-m-1 mb-3 flex cursor-pointer items-center gap-2 rounded-md p-1 transition-colors hover:bg-components-button-ghost-bg-hover"
                      onClick={() => toggleModelCollapse(modelKey)}
                    >
                      <RiArrowRightSLine
                        className={cn(
                          'h-4 w-4 shrink-0 text-text-tertiary transition-transform',
                          !isCollapsed && 'rotate-90',
                        )}
                      />
                      <div className="font-medium text-text-primary">
                        {model.model_name}
                      </div>
                      <div className="text-xs text-text-tertiary">
                        ({model.workflows.length} {t('common.modelProvider.workflowsCount')})
                      </div>
                    </div>

                    {!isCollapsed && (
                      <div className="space-y-2">
                        {model.workflows.map((workflow, workflowIndex) => (
                          <div x-id={`${workflow.workflow_id}-${workflowIndex}`}
                            key={`${workflow.workflow_id}-${workflowIndex}`}
                            className={cn(
                              'flex items-center justify-between rounded-md border border-divider-subtle p-2',
                              'cursor-pointer transition-colors hover:bg-components-button-ghost-bg-hover',
                            )}
                            onClick={() => handleWorkflowClick(workflow.app_id)}
                          >
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-sm font-medium text-text-primary">
                                {workflow.workflow_name}
                              </div>
                              <div className="truncate text-xs text-text-tertiary">
                                {workflow.app_name} • {workflow.node_title}
                              </div>
                            </div>
                            <RiExternalLinkFill className="ml-2 h-4 w-4 shrink-0 text-text-tertiary" />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        <div className="mt-6 flex justify-end border-t border-divider-subtle pt-4">
          <button
            type="button"
            className="flex items-center gap-2 rounded-lg border border-divider-subtle px-4 py-2 text-sm font-medium text-text-secondary transition-colors hover:bg-components-button-ghost-bg-hover hover:text-text-primary"
            onClick={onClose}
          >
            <RiCloseLine className="h-4 w-4" />
            {t('common.operation.close')}
          </button>
        </div>
      </div>
    </Modal>
  )
}

export default ModelReferencesPopup
