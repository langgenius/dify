'use client'

import type { Dispatch, SetStateAction } from 'react'
import { useCallback, useEffect, useState } from 'react'
import { createContext, useContext, useContextSelector } from 'use-context-selector'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import dynamic from 'next/dynamic'
import { noop } from 'lodash-es'

import { removeSpecificQueryParam } from '@/utils'
import { EDUCATION_VERIFYING_LOCALSTORAGE_ITEM } from '@/app/education-apply/constants'

import type {
  ConfigurationMethodEnum,
  CustomConfigurationModelFixedFields,
  ModelLoadBalancingConfigEntry,
  ModelProvider,
} from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { ModerationConfig, PromptVariable } from '@/models/debug'
import type {
  ApiBasedExtension,
  ExternalDataTool,
} from '@/models/common'
import type { CreateExternalAPIReq } from '@/app/components/datasets/external-api/declarations'
import type { ModelLoadBalancingModalProps } from '@/app/components/header/account-setting/model-provider-page/provider-added-card/model-load-balancing-modal'
import type { OpeningStatement } from '@/app/components/base/features/types'
import type { InputVar } from '@/app/components/workflow/types'
import type { UpdatePluginPayload } from '@/app/components/plugins/types'

const AccountSetting = dynamic(() => import('@/app/components/header/account-setting'), {
  ssr: false,
})
const ApiBasedExtensionModal = dynamic(() => import('@/app/components/header/account-setting/api-based-extension-page/modal'), {
  ssr: false,
})
const ModerationSettingModal = dynamic(() => import('@/app/components/base/features/new-feature-panel/moderation/moderation-setting-modal'), {
  ssr: false,
})
const ExternalDataToolModal = dynamic(() => import('@/app/components/app/configuration/tools/external-data-tool-modal'), {
  ssr: false,
})
const Pricing = dynamic(() => import('@/app/components/billing/pricing'), {
  ssr: false,
})
const AnnotationFullModal = dynamic(() => import('@/app/components/billing/annotation-full/modal'), {
  ssr: false,
})
const ModelModal = dynamic(() => import('@/app/components/header/account-setting/model-provider-page/model-modal'), {
  ssr: false,
})
const ExternalAPIModal = dynamic(() => import('@/app/components/datasets/external-api/external-api-modal'), {
  ssr: false,
})
const ModelLoadBalancingModal = dynamic(() => import('@/app/components/header/account-setting/model-provider-page/provider-added-card/model-load-balancing-modal'), {
  ssr: false,
})
const ModelLoadBalancingEntryModal = dynamic(() => import('@/app/components/header/account-setting/model-provider-page/model-modal/model-load-balancing-entry-modal'), {
  ssr: false,
})
const OpeningSettingModal = dynamic(() => import('@/app/components/base/features/new-feature-panel/conversation-opener/modal'), {
  ssr: false,
})
const UpdatePlugin = dynamic(() => import('@/app/components/plugins/update-plugin'), {
  ssr: false,
})

export type ModalState<T> = {
  payload: T
  onCancelCallback?: () => void
  onSaveCallback?: (newPayload: T) => void
  onRemoveCallback?: (newPayload: T) => void
  onEditCallback?: (newPayload: T) => void
  onValidateBeforeSaveCallback?: (newPayload: T) => boolean
  isEditMode?: boolean
  datasetBindings?: { id: string; name: string }[]
}

export type ModelModalType = {
  currentProvider: ModelProvider
  currentConfigurationMethod: ConfigurationMethodEnum
  currentCustomConfigurationModelFixedFields?: CustomConfigurationModelFixedFields
}

export type LoadBalancingEntryModalType = ModelModalType & {
  entry?: ModelLoadBalancingConfigEntry
  index?: number
}

export type ModalContextState = {
  setShowAccountSettingModal: Dispatch<SetStateAction<ModalState<string> | null>>
  setShowApiBasedExtensionModal: Dispatch<SetStateAction<ModalState<ApiBasedExtension> | null>>
  setShowModerationSettingModal: Dispatch<SetStateAction<ModalState<ModerationConfig> | null>>
  setShowExternalDataToolModal: Dispatch<SetStateAction<ModalState<ExternalDataTool> | null>>
  setShowPricingModal: () => void
  setShowAnnotationFullModal: () => void
  setShowModelModal: Dispatch<SetStateAction<ModalState<ModelModalType> | null>>
  setShowExternalKnowledgeAPIModal: Dispatch<SetStateAction<ModalState<CreateExternalAPIReq> | null>>
  setShowModelLoadBalancingModal: Dispatch<SetStateAction<ModelLoadBalancingModalProps | null>>
  setShowModelLoadBalancingEntryModal: Dispatch<SetStateAction<ModalState<LoadBalancingEntryModalType> | null>>
  setShowOpeningModal: Dispatch<SetStateAction<ModalState<OpeningStatement & {
    promptVariables?: PromptVariable[]
    workflowVariables?: InputVar[]
    onAutoAddPromptVariable?: (variable: PromptVariable[]) => void
  }> | null>>
  setShowUpdatePluginModal: Dispatch<SetStateAction<ModalState<UpdatePluginPayload> | null>>
}

const ModalContext = createContext<ModalContextState>({
  setShowAccountSettingModal: noop,
  setShowApiBasedExtensionModal: noop,
  setShowModerationSettingModal: noop,
  setShowExternalDataToolModal: noop,
  setShowPricingModal: noop,
  setShowAnnotationFullModal: noop,
  setShowModelModal: noop,
  setShowExternalKnowledgeAPIModal: noop,
  setShowModelLoadBalancingModal: noop,
  setShowModelLoadBalancingEntryModal: noop,
  setShowOpeningModal: noop,
  setShowUpdatePluginModal: noop,
})

export const useModalContext = () => useContext(ModalContext)

// Adding a dangling comma to avoid the generic parsing issue in tsx, see:
// https://github.com/microsoft/TypeScript/issues/15713
export const useModalContextSelector = <T,>(selector: (state: ModalContextState) => T): T =>
  useContextSelector(ModalContext, selector)

type ModalContextProviderProps = {
  children: React.ReactNode
}

export const ModalContextProvider = ({
  children,
}: ModalContextProviderProps) => {
  const [showAccountSettingModal, setShowAccountSettingModal] = useState<ModalState<string> | null>(null)
  const [showApiBasedExtensionModal, setShowApiBasedExtensionModal] = useState<ModalState<ApiBasedExtension> | null>(null)
  const [showModerationSettingModal, setShowModerationSettingModal] = useState<ModalState<ModerationConfig> | null>(null)
  const [showExternalDataToolModal, setShowExternalDataToolModal] = useState<ModalState<ExternalDataTool> | null>(null)
  const [showModelModal, setShowModelModal] = useState<ModalState<ModelModalType> | null>(null)
  const [showExternalKnowledgeAPIModal, setShowExternalKnowledgeAPIModal] = useState<ModalState<CreateExternalAPIReq> | null>(null)
  const [showModelLoadBalancingModal, setShowModelLoadBalancingModal] = useState<ModelLoadBalancingModalProps | null>(null)
  const [showModelLoadBalancingEntryModal, setShowModelLoadBalancingEntryModal] = useState<ModalState<LoadBalancingEntryModalType> | null>(null)
  const [showOpeningModal, setShowOpeningModal] = useState<ModalState<OpeningStatement & {
    promptVariables?: PromptVariable[]
    workflowVariables?: InputVar[]
    onAutoAddPromptVariable?: (variable: PromptVariable[]) => void
  }> | null>(null)
  const [showUpdatePluginModal, setShowUpdatePluginModal] = useState<ModalState<UpdatePluginPayload> | null>(null)
  const [showPricingModal, setShowPricingModal] = useState(false)
  const [showAnnotationFullModal, setShowAnnotationFullModal] = useState(false)

  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()

  // Generic modal handlers factory
  const createModalHandlers = useCallback(<T,>(
    modalState: ModalState<T> | null,
    setModalState: Dispatch<SetStateAction<ModalState<T> | null>>,
  ) => ({
    handleCancel: () => {
      setModalState(null)
      modalState?.onCancelCallback?.()
    },
    handleSave: (payload: T) => {
      modalState?.onSaveCallback?.(payload)
      setModalState(null)
    },
    handleEdit: (payload: T) => {
      modalState?.onEditCallback?.(payload)
      setModalState(null)
    },
    handleRemove: (payload: T) => {
      modalState?.onRemoveCallback?.(payload)
      setModalState(null)
    },
  }), [])

  // Initialize pricing modal from URL params
  useEffect(() => {
    setShowPricingModal(searchParams.get('show-pricing') === '1')
  }, [searchParams])

  // Close all modals
  const closeAllModals = useCallback(() => {
    setShowAccountSettingModal(null)
    setShowApiBasedExtensionModal(null)
    setShowModerationSettingModal(null)
    setShowExternalDataToolModal(null)
    setShowModelModal(null)
    setShowExternalKnowledgeAPIModal(null)
    setShowModelLoadBalancingModal(null)
    setShowModelLoadBalancingEntryModal(null)
    setShowOpeningModal(null)
    setShowUpdatePluginModal(null)
    setShowPricingModal(false)
    setShowAnnotationFullModal(false)
  }, [])

  // Modal handlers
  const moderationHandlers = createModalHandlers(showModerationSettingModal, setShowModerationSettingModal)
  const externalDataToolHandlers = createModalHandlers(showExternalDataToolModal, setShowExternalDataToolModal)
  const modelHandlers = createModalHandlers(showModelModal, setShowModelModal)
  const externalApiHandlers = createModalHandlers(showExternalKnowledgeAPIModal, setShowExternalKnowledgeAPIModal)
  const loadBalancingEntryHandlers = createModalHandlers(showModelLoadBalancingEntryModal, setShowModelLoadBalancingEntryModal)
  const openingHandlers = createModalHandlers(showOpeningModal, setShowOpeningModal)

  // Account setting modal with special handling
  const handleCancelAccountSettingModal = useCallback(() => {
    const educationVerifying = localStorage.getItem(EDUCATION_VERIFYING_LOCALSTORAGE_ITEM)
    if (educationVerifying === 'yes')
      localStorage.removeItem(EDUCATION_VERIFYING_LOCALSTORAGE_ITEM)

    removeSpecificQueryParam('action')
    setShowAccountSettingModal(null)
    showAccountSettingModal?.onCancelCallback?.()
  }, [showAccountSettingModal])

  // External API modal handlers
  const handleSaveExternalApiModal = useCallback(async (updatedFormValue: CreateExternalAPIReq) => {
    externalApiHandlers.handleSave(updatedFormValue)
  }, [externalApiHandlers])

  const handleEditExternalApiModal = useCallback(async (updatedFormValue: CreateExternalAPIReq) => {
    externalApiHandlers.handleEdit(updatedFormValue)
  }, [externalApiHandlers])

  // Load balancing entry modal handlers
  const handleSaveModelLoadBalancingEntryModal = useCallback((entry: ModelLoadBalancingConfigEntry) => {
    if (showModelLoadBalancingEntryModal) {
      loadBalancingEntryHandlers.handleSave({
        ...showModelLoadBalancingEntryModal.payload,
        entry,
      })
    }
  }, [loadBalancingEntryHandlers, showModelLoadBalancingEntryModal])

  const handleRemoveModelLoadBalancingEntry = useCallback(() => {
    if (showModelLoadBalancingEntryModal)
      loadBalancingEntryHandlers.handleRemove(showModelLoadBalancingEntryModal.payload)
  }, [loadBalancingEntryHandlers, showModelLoadBalancingEntryModal])

  // Simple save handlers
  const handleSaveApiBasedExtension = useCallback((newApiBasedExtension: ApiBasedExtension) => {
    showApiBasedExtensionModal?.onSaveCallback?.(newApiBasedExtension)
    setShowApiBasedExtensionModal(null)
  }, [showApiBasedExtensionModal])

  const handleValidateBeforeSaveExternalDataTool = useCallback((newExternalDataTool: ExternalDataTool) => {
    return showExternalDataToolModal?.onValidateBeforeSaveCallback?.(newExternalDataTool) ?? true
  }, [showExternalDataToolModal])

  useEffect(() => {
    closeAllModals()
  }, [pathname, closeAllModals])

  return (
    <ModalContext.Provider value={{
      setShowAccountSettingModal,
      setShowApiBasedExtensionModal,
      setShowModerationSettingModal,
      setShowExternalDataToolModal,
      setShowPricingModal: () => setShowPricingModal(true),
      setShowAnnotationFullModal: () => setShowAnnotationFullModal(true),
      setShowModelModal,
      setShowExternalKnowledgeAPIModal,
      setShowModelLoadBalancingModal,
      setShowModelLoadBalancingEntryModal,
      setShowOpeningModal,
      setShowUpdatePluginModal,
    }}>
      <>
        {children}
        {!!showAccountSettingModal && (
          <AccountSetting
            activeTab={showAccountSettingModal.payload}
            onCancel={handleCancelAccountSettingModal}
          />
        )}

        {!!showApiBasedExtensionModal && (
          <ApiBasedExtensionModal
            data={showApiBasedExtensionModal.payload}
            onCancel={() => setShowApiBasedExtensionModal(null)}
            onSave={handleSaveApiBasedExtension}
          />
        )}

        {!!showModerationSettingModal && (
          <ModerationSettingModal
            data={showModerationSettingModal.payload}
            onCancel={moderationHandlers.handleCancel}
            onSave={moderationHandlers.handleSave}
          />
        )}

        {!!showExternalDataToolModal && (
          <ExternalDataToolModal
            data={showExternalDataToolModal.payload}
            onCancel={externalDataToolHandlers.handleCancel}
            onSave={externalDataToolHandlers.handleSave}
            onValidateBeforeSave={handleValidateBeforeSaveExternalDataTool}
          />
        )}

        {!!showPricingModal && (
          <Pricing onCancel={() => {
            if (searchParams.get('show-pricing') === '1')
              router.push(location.pathname, { forceOptimisticNavigation: true } as any)

            setShowPricingModal(false)
          }} />
        )}

        {showAnnotationFullModal && (
          <AnnotationFullModal
            show={showAnnotationFullModal}
            onHide={() => setShowAnnotationFullModal(false)} />
        )}

        {!!showModelModal && (
          <ModelModal
            provider={showModelModal.payload.currentProvider}
            configurateMethod={showModelModal.payload.currentConfigurationMethod}
            currentCustomConfigurationModelFixedFields={showModelModal.payload.currentCustomConfigurationModelFixedFields}
            onCancel={modelHandlers.handleCancel}
            onSave={() => modelHandlers.handleSave(showModelModal.payload)}
          />
        )}

        {!!showExternalKnowledgeAPIModal && (
          <ExternalAPIModal
            data={showExternalKnowledgeAPIModal.payload}
            datasetBindings={showExternalKnowledgeAPIModal.datasetBindings ?? []}
            onSave={handleSaveExternalApiModal}
            onCancel={externalApiHandlers.handleCancel}
            onEdit={handleEditExternalApiModal}
            isEditMode={showExternalKnowledgeAPIModal.isEditMode ?? false}
          />
        )}

        {Boolean(showModelLoadBalancingModal) && (
          <ModelLoadBalancingModal {...showModelLoadBalancingModal!} />
        )}

        {!!showModelLoadBalancingEntryModal && (
          <ModelLoadBalancingEntryModal
            provider={showModelLoadBalancingEntryModal.payload.currentProvider}
            configurationMethod={showModelLoadBalancingEntryModal.payload.currentConfigurationMethod}
            currentCustomConfigurationModelFixedFields={showModelLoadBalancingEntryModal.payload.currentCustomConfigurationModelFixedFields}
            entry={showModelLoadBalancingEntryModal.payload.entry}
            onCancel={loadBalancingEntryHandlers.handleCancel}
            onSave={handleSaveModelLoadBalancingEntryModal}
            onRemove={handleRemoveModelLoadBalancingEntry}
          />
        )}

        {showOpeningModal && (
          <OpeningSettingModal
            data={showOpeningModal.payload}
            onSave={openingHandlers.handleSave}
            onCancel={openingHandlers.handleCancel}
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
              setShowUpdatePluginModal(null)
              showUpdatePluginModal.onSaveCallback?.({} as any)
            }}
          />
        )}
      </>
    </ModalContext.Provider>
  )
}

export default ModalContext
