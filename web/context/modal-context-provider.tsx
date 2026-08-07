'use client'

import type { ReactNode } from 'react'
import type { ModalState, ModelModalType } from './modal-context'
import type { OpeningStatement } from '@/app/components/base/features/types'
import type { CreateExternalAPIReq } from '@/app/components/datasets/external-api/declarations'
import type { UpdatePluginPayload } from '@/app/components/plugins/types'
import type { InputVar } from '@/app/components/workflow/types'
import type { ExternalDataTool } from '@/models/common'
import type { ModerationConfig, PromptVariable } from '@/models/debug'
import { useAtomValue } from 'jotai'
import { useCallback, useState } from 'react'
import { PluginCategoryEnum } from '@/app/components/plugins/types'
import { useProviderContext } from '@/context/provider-context'
import { currentWorkspaceIdAtom } from '@/context/workspace-state'
import { usePricingModal } from '@/hooks/use-query-params'
import dynamic from '@/next/dynamic'
import { useTriggerEventsLimitModal } from './hooks/use-trigger-events-limit-modal'
import { ModalContext } from './modal-context'

const ModerationSettingModal = dynamic(
  () =>
    import('@/app/components/base/features/new-feature-panel/moderation/moderation-setting-modal'),
  {
    ssr: false,
  },
)
const ExternalDataToolModal = dynamic(
  () => import('@/app/components/app/configuration/tools/external-data-tool-modal'),
  {
    ssr: false,
  },
)
const Pricing = dynamic(() => import('@/app/components/billing/pricing'), {
  ssr: false,
})
const AnnotationFullModal = dynamic(
  () => import('@/app/components/billing/annotation-full/modal'),
  {
    ssr: false,
  },
)
const ModelModal = dynamic(
  () => import('@/app/components/header/account-setting/model-provider-page/model-modal'),
  {
    ssr: false,
  },
)
const ExternalAPIModal = dynamic(
  () => import('@/app/components/datasets/external-api/external-api-modal'),
  {
    ssr: false,
  },
)
const OpeningSettingModal = dynamic(
  () => import('@/app/components/base/features/new-feature-panel/conversation-opener/modal'),
  {
    ssr: false,
  },
)
const UpdatePlugin = dynamic(() => import('@/app/components/plugins/update-plugin'), {
  ssr: false,
})

const TriggerEventsLimitModal = dynamic(
  () => import('@/app/components/billing/trigger-events-limit-modal'),
  {
    ssr: false,
  },
)

type ModalContextProviderProps = {
  children: ReactNode
}
export const ModalContextProvider = ({ children }: ModalContextProviderProps) => {
  const [showPricingModal, setPricingModalOpen] = usePricingModal()
  const [showModerationSettingModal, setShowModerationSettingModal] =
    useState<ModalState<ModerationConfig> | null>(null)
  const [showExternalDataToolModal, setShowExternalDataToolModal] =
    useState<ModalState<ExternalDataTool> | null>(null)
  const [showModelModal, setShowModelModal] = useState<ModalState<ModelModalType> | null>(null)
  const [showExternalKnowledgeAPIModal, setShowExternalKnowledgeAPIModal] =
    useState<ModalState<CreateExternalAPIReq> | null>(null)
  const [showOpeningModal, setShowOpeningModal] = useState<ModalState<
    OpeningStatement & {
      promptVariables?: PromptVariable[]
      workflowVariables?: InputVar[]
      onAutoAddPromptVariable?: (variable: PromptVariable[]) => void
    }
  > | null>(null)
  const [showUpdatePluginModal, setShowUpdatePluginModal] =
    useState<ModalState<UpdatePluginPayload> | null>(null)
  const currentWorkspaceId = useAtomValue(currentWorkspaceIdAtom)

  const [showAnnotationFullModal, setShowAnnotationFullModal] = useState(false)
  const { plan, isFetchedPlan } = useProviderContext()
  const { triggerEventsLimitModal, dismissTriggerEventsLimitModal } = useTriggerEventsLimitModal({
    plan,
    isFetchedPlan,
    currentWorkspaceId,
  })

  const handleCancelModerationSettingModal = () => {
    setShowModerationSettingModal(null)
    if (showModerationSettingModal?.onCancelCallback) showModerationSettingModal.onCancelCallback()
  }

  const handleCancelExternalDataToolModal = () => {
    setShowExternalDataToolModal(null)
    if (showExternalDataToolModal?.onCancelCallback) showExternalDataToolModal.onCancelCallback()
  }

  const handleCancelModelModal = useCallback(() => {
    setShowModelModal(null)
    if (showModelModal?.onCancelCallback) showModelModal.onCancelCallback()
  }, [showModelModal])

  const handleSaveModelModal = useCallback(
    (formValues?: Record<string, unknown>) => {
      if (showModelModal?.onSaveCallback)
        showModelModal.onSaveCallback(showModelModal.payload, formValues)
      setShowModelModal(null)
    },
    [showModelModal],
  )

  const handleRemoveModelModal = useCallback(
    (formValues?: Record<string, unknown>) => {
      if (showModelModal?.onRemoveCallback)
        showModelModal.onRemoveCallback(showModelModal.payload, formValues)
      setShowModelModal(null)
    },
    [showModelModal],
  )

  const handleCancelExternalApiModal = useCallback(() => {
    setShowExternalKnowledgeAPIModal(null)
    if (showExternalKnowledgeAPIModal?.onCancelCallback)
      showExternalKnowledgeAPIModal.onCancelCallback()
  }, [showExternalKnowledgeAPIModal])

  const handleSaveExternalApiModal = useCallback(
    async (updatedFormValue: CreateExternalAPIReq) => {
      if (showExternalKnowledgeAPIModal?.onSaveCallback)
        showExternalKnowledgeAPIModal.onSaveCallback(updatedFormValue)
      setShowExternalKnowledgeAPIModal(null)
    },
    [showExternalKnowledgeAPIModal],
  )

  const handleEditExternalApiModal = useCallback(
    async (updatedFormValue: CreateExternalAPIReq) => {
      if (showExternalKnowledgeAPIModal?.onEditCallback)
        showExternalKnowledgeAPIModal.onEditCallback(updatedFormValue)
      setShowExternalKnowledgeAPIModal(null)
    },
    [showExternalKnowledgeAPIModal],
  )

  const handleCancelOpeningModal = useCallback(() => {
    setShowOpeningModal(null)
    if (showOpeningModal?.onCancelCallback) showOpeningModal.onCancelCallback()
  }, [showOpeningModal])

  const handleSaveModeration = (newModerationConfig: ModerationConfig) => {
    if (showModerationSettingModal?.onSaveCallback)
      showModerationSettingModal.onSaveCallback(newModerationConfig)
    setShowModerationSettingModal(null)
  }

  const handleSaveExternalDataTool = (newExternalDataTool: ExternalDataTool) => {
    if (showExternalDataToolModal?.onSaveCallback)
      showExternalDataToolModal.onSaveCallback(newExternalDataTool)
    setShowExternalDataToolModal(null)
  }

  const handleValidateBeforeSaveExternalDataTool = (newExternalDataTool: ExternalDataTool) => {
    if (showExternalDataToolModal?.onValidateBeforeSaveCallback)
      return showExternalDataToolModal?.onValidateBeforeSaveCallback(newExternalDataTool)
    return true
  }

  const handleSaveOpeningModal = (newOpening: OpeningStatement) => {
    if (showOpeningModal?.onSaveCallback) showOpeningModal.onSaveCallback(newOpening)
    setShowOpeningModal(null)
  }

  const handleShowPricingModal = useCallback(() => {
    setPricingModalOpen(true)
  }, [setPricingModalOpen])

  const handleCancelPricingModal = useCallback(() => {
    setPricingModalOpen(false)
  }, [setPricingModalOpen])
  const hasBlockingModalOpen = Boolean(
    showModerationSettingModal ||
    showExternalDataToolModal ||
    showPricingModal ||
    showAnnotationFullModal ||
    showModelModal ||
    showExternalKnowledgeAPIModal ||
    showOpeningModal ||
    showUpdatePluginModal ||
    triggerEventsLimitModal,
  )

  return (
    <ModalContext.Provider
      value={{
        hasBlockingModalOpen,
        setShowModerationSettingModal,
        setShowExternalDataToolModal,
        setShowPricingModal: handleShowPricingModal,
        setShowAnnotationFullModal: () => setShowAnnotationFullModal(true),
        setShowModelModal,
        setShowExternalKnowledgeAPIModal,
        setShowOpeningModal,
        setShowUpdatePluginModal,
      }}
    >
      <>
        {children}
        {!!showModerationSettingModal && (
          <ModerationSettingModal
            data={showModerationSettingModal.payload}
            onCancel={handleCancelModerationSettingModal}
            onSave={handleSaveModeration}
          />
        )}
        {!!showExternalDataToolModal && (
          <ExternalDataToolModal
            data={showExternalDataToolModal.payload}
            onCancel={handleCancelExternalDataToolModal}
            onSave={handleSaveExternalDataTool}
            onValidateBeforeSave={handleValidateBeforeSaveExternalDataTool}
          />
        )}

        {!!showPricingModal && <Pricing onCancel={handleCancelPricingModal} />}

        {showAnnotationFullModal && (
          <AnnotationFullModal
            show={showAnnotationFullModal}
            onHide={() => setShowAnnotationFullModal(false)}
          />
        )}
        {!!showModelModal && (
          <ModelModal
            provider={showModelModal.payload.currentProvider}
            configurateMethod={showModelModal.payload.currentConfigurationMethod}
            currentCustomConfigurationModelFixedFields={
              showModelModal.payload.currentCustomConfigurationModelFixedFields
            }
            isModelCredential={showModelModal.payload.isModelCredential}
            credential={showModelModal.payload.credential}
            model={showModelModal.payload.model}
            mode={showModelModal.payload.mode}
            onCancel={handleCancelModelModal}
            onSave={handleSaveModelModal}
            onRemove={handleRemoveModelModal}
          />
        )}
        {!!showExternalKnowledgeAPIModal && (
          <ExternalAPIModal
            data={showExternalKnowledgeAPIModal.payload}
            datasetBindings={showExternalKnowledgeAPIModal.datasetBindings ?? []}
            onSave={handleSaveExternalApiModal}
            onCancel={handleCancelExternalApiModal}
            onEdit={handleEditExternalApiModal}
            isEditMode={showExternalKnowledgeAPIModal.isEditMode ?? false}
          />
        )}
        {showOpeningModal && (
          <OpeningSettingModal
            data={showOpeningModal.payload}
            onSave={handleSaveOpeningModal}
            onCancel={handleCancelOpeningModal}
            promptVariables={showOpeningModal.payload.promptVariables}
            workflowVariables={showOpeningModal.payload.workflowVariables}
            onAutoAddPromptVariable={showOpeningModal.payload.onAutoAddPromptVariable}
          />
        )}

        {!!showUpdatePluginModal && (
          <UpdatePlugin
            {...showUpdatePluginModal.payload}
            onCancel={() => {
              setShowUpdatePluginModal(null)
              showUpdatePluginModal.onCancelCallback?.()
            }}
            onSave={() => {
              if (showUpdatePluginModal.payload.category !== PluginCategoryEnum.model) {
                setShowUpdatePluginModal(null)
                showUpdatePluginModal.onSaveCallback?.()
                return
              }

              return Promise.resolve(showUpdatePluginModal.onSaveCallback?.()).then(() => {
                setShowUpdatePluginModal(null)
              })
            }}
          />
        )}
        {!!triggerEventsLimitModal && (
          <TriggerEventsLimitModal
            show
            usage={triggerEventsLimitModal.usage}
            total={triggerEventsLimitModal.total}
            resetInDays={triggerEventsLimitModal.resetInDays}
            onClose={dismissTriggerEventsLimitModal}
            onUpgrade={() => {
              dismissTriggerEventsLimitModal()
              handleShowPricingModal()
            }}
          />
        )}
      </>
    </ModalContext.Provider>
  )
}
