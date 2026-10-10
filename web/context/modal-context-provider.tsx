'use client'

import type { ReactNode } from 'react'
import type { ModalContextState, ModalState, ModelModalType } from './modal-context'
import type { OpeningStatement } from '@/app/components/base/features/types'
import type { CreateExternalAPIReq } from '@/app/components/datasets/external-api/declarations'
import type { UpdatePluginPayload } from '@/app/components/plugins/types'
import type { InputVar } from '@/app/components/workflow/types'
import type { ExternalDataTool } from '@/models/common'
import type { ModerationConfig, PromptVariable } from '@/models/debug'
import dynamic from 'next/dynamic'
import { useCallback, useState } from 'react'
import { PluginCategoryEnum } from '@/app/components/plugins/types'
import { useTriggerEventsLimitModal } from './hooks/use-trigger-events-limit-modal'
import { ModalContext } from './modal-context'

const ModerationSettingModal = dynamic(
  () =>
    import('@/app/components/base/features/new-feature-panel/moderation/moderation-setting-modal').then(
      (module) => module.ModerationSettingModal,
    ),
  {
    ssr: false,
  },
)
const ExternalDataToolModal = dynamic(
  () =>
    import('@/app/components/app/configuration/tools/external-data-tool-modal').then(
      (module) => module.ExternalDataToolModal,
    ),
  {
    ssr: false,
  },
)
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
  () =>
    import('@/app/components/base/features/new-feature-panel/conversation-opener/modal').then(
      (module) => module.OpeningSettingModal,
    ),
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

type DialogSession<T> = {
  open: boolean
  modal: ModalState<T>
}

type ModalContextProviderProps = {
  children: ReactNode
}
export const ModalContextProvider = ({ children }: ModalContextProviderProps) => {
  const [moderationSession, setModerationSession] =
    useState<DialogSession<ModerationConfig> | null>(null)
  const [externalDataToolSession, setExternalDataToolSession] =
    useState<DialogSession<ExternalDataTool> | null>(null)
  const [showModelModal, setShowModelModal] = useState<ModalState<ModelModalType> | null>(null)
  const [showExternalKnowledgeAPIModal, setShowExternalKnowledgeAPIModal] =
    useState<ModalState<CreateExternalAPIReq> | null>(null)
  const [openingSession, setOpeningSession] = useState<DialogSession<
    OpeningStatement & {
      promptVariables?: PromptVariable[]
      workflowVariables?: InputVar[]
      onAutoAddPromptVariable?: (variable: PromptVariable[]) => void
    }
  > | null>(null)
  const [showUpdatePluginModal, setShowUpdatePluginModal] =
    useState<ModalState<UpdatePluginPayload> | null>(null)
  const [showAnnotationFullModal, setShowAnnotationFullModal] = useState(false)
  const { triggerEventsLimitModal, dismissTriggerEventsLimitModal } = useTriggerEventsLimitModal()

  const setShowModerationSettingModal = useCallback<
    ModalContextState['setShowModerationSettingModal']
  >((action) => {
    setModerationSession((previous) => {
      const current = previous?.open ? previous.modal : null
      const next = typeof action === 'function' ? action(current) : action
      if (next === current) return previous
      if (next) return { open: true, modal: next }
      return previous ? { ...previous, open: false } : null
    })
  }, [])
  const setShowExternalDataToolModal = useCallback<
    ModalContextState['setShowExternalDataToolModal']
  >((action) => {
    setExternalDataToolSession((previous) => {
      const current = previous?.open ? previous.modal : null
      const next = typeof action === 'function' ? action(current) : action
      if (next === current) return previous
      if (next) return { open: true, modal: next }
      return previous ? { ...previous, open: false } : null
    })
  }, [])
  const setShowOpeningModal = useCallback<ModalContextState['setShowOpeningModal']>((action) => {
    setOpeningSession((previous) => {
      const current = previous?.open ? previous.modal : null
      const next = typeof action === 'function' ? action(current) : action
      if (next === current) return previous
      if (next) return { open: true, modal: next }
      return previous ? { ...previous, open: false } : null
    })
  }, [])

  const showModerationSettingModal = moderationSession?.open ? moderationSession.modal : null
  const showExternalDataToolModal = externalDataToolSession?.open
    ? externalDataToolSession.modal
    : null
  const showOpeningModal = openingSession?.open ? openingSession.modal : null

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
  }, [setShowOpeningModal, showOpeningModal])

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

  const hasBlockingModalOpen = Boolean(
    showModerationSettingModal ||
    showExternalDataToolModal ||
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
        setShowAnnotationFullModal: () => setShowAnnotationFullModal(true),
        setShowModelModal,
        setShowExternalKnowledgeAPIModal,
        setShowOpeningModal,
        setShowUpdatePluginModal,
      }}
    >
      <>
        {children}
        {moderationSession && (
          <ModerationSettingModal
            open={moderationSession.open}
            onOpenChange={(open) => {
              if (!open) handleCancelModerationSettingModal()
            }}
            data={moderationSession.modal.payload}
            onSave={handleSaveModeration}
          />
        )}
        {externalDataToolSession && (
          <ExternalDataToolModal
            open={externalDataToolSession.open}
            onOpenChange={(open) => {
              if (!open) handleCancelExternalDataToolModal()
            }}
            data={externalDataToolSession.modal.payload}
            onSave={handleSaveExternalDataTool}
            onValidateBeforeSave={handleValidateBeforeSaveExternalDataTool}
          />
        )}

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
        {openingSession && (
          <OpeningSettingModal
            open={openingSession.open}
            onOpenChange={(open) => {
              if (!open) handleCancelOpeningModal()
            }}
            data={openingSession.modal.payload}
            onSave={handleSaveOpeningModal}
            promptVariables={openingSession.modal.payload.promptVariables}
            workflowVariables={openingSession.modal.payload.workflowVariables}
            onAutoAddPromptVariable={openingSession.modal.payload.onAutoAddPromptVariable}
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
          />
        )}
      </>
    </ModalContext.Provider>
  )
}
