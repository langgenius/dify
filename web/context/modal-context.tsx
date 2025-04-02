'use client'

import type { Dispatch, SetStateAction } from 'react'
import { useCallback, useState } from 'react'
import { createContext, useContext, useContextSelector } from 'use-context-selector'
import { useRouter, useSearchParams } from 'next/navigation'
import AccountSetting from '@/app/components/header/account-setting'
import ApiBasedExtensionModal from '@/app/components/header/account-setting/api-based-extension-page/modal'
import ModerationSettingModal from '@/app/components/base/features/new-feature-panel/moderation/moderation-setting-modal'
import ExternalDataToolModal from '@/app/components/app/configuration/tools/external-data-tool-modal'
import AnnotationFullModal from '@/app/components/billing/annotation-full/modal'
import ModelModal from '@/app/components/header/account-setting/model-provider-page/model-modal'
import ExternalAPIModal from '@/app/components/datasets/external-api/external-api-modal'
import type {
  ConfigurationMethodEnum,
  CustomConfigurationModelFixedFields,
  ModelLoadBalancingConfigEntry,
  ModelProvider,
} from '@/app/components/header/account-setting/model-provider-page/declarations'
import {
  EDUCATION_VERIFYING_LOCALSTORAGE_ITEM,
} from '@/app/education-apply/constants'
import Pricing from '@/app/components/billing/pricing'
import type { ModerationConfig, PromptVariable } from '@/models/debug'
import type {
  ApiBasedExtension,
  ExternalDataTool,
} from '@/models/common'
import type { CreateExternalAPIReq } from '@/app/components/datasets/external-api/declarations'
import ModelLoadBalancingEntryModal from '@/app/components/header/account-setting/model-provider-page/model-modal/model-load-balancing-entry-modal'
import type { ModelLoadBalancingModalProps } from '@/app/components/header/account-setting/model-provider-page/provider-added-card/model-load-balancing-modal'
import ModelLoadBalancingModal from '@/app/components/header/account-setting/model-provider-page/provider-added-card/model-load-balancing-modal'
import OpeningSettingModal from '@/app/components/base/features/new-feature-panel/conversation-opener/modal'
import type { OpeningStatement } from '@/app/components/base/features/types'
import type { InputVar } from '@/app/components/workflow/types'
import type { UpdatePluginPayload } from '@/app/components/plugins/types'
import UpdatePlugin from '@/app/components/plugins/update-plugin'
import { removeSpecificQueryParam } from '@/utils'

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
  setShowAccountSettingModal: () => { },
  setShowApiBasedExtensionModal: () => { },
  setShowModerationSettingModal: () => { },
  setShowExternalDataToolModal: () => { },
  setShowPricingModal: () => { },
  setShowAnnotationFullModal: () => { },
  setShowModelModal: () => { },
  setShowExternalKnowledgeAPIModal: () => { },
  setShowModelLoadBalancingModal: () => { },
  setShowModelLoadBalancingEntryModal: () => { },
  setShowOpeningModal: () => { },
  setShowUpdatePluginModal: () => { },
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

  const searchParams = useSearchParams()
  const router = useRouter()
  const [showPricingModal, setShowPricingModal] = useState(searchParams.get('show-pricing') === '1')
  const [showAnnotationFullModal, setShowAnnotationFullModal] = useState(false)
  const handleCancelAccountSettingModal = () => {
    const educationVerifying = localStorage.getItem(EDUCATION_VERIFYING_LOCALSTORAGE_ITEM)

    if (educationVerifying === 'yes')
      localStorage.removeItem(EDUCATION_VERIFYING_LOCALSTORAGE_ITEM)

    removeSpecificQueryParam('action')
    setShowAccountSettingModal(null)
    if (showAccountSettingModal?.onCancelCallback)
      showAccountSettingModal?.onCancelCallback()
  }

  const handleCancelModerationSettingModal = () => {
    setShowModerationSettingModal(null)
    if (showModerationSettingModal?.onCancelCallback)
      showModerationSettingModal.onCancelCallback()
  }

  const handleCancelExternalDataToolModal = () => {
    setShowExternalDataToolModal(null)
    if (showExternalDataToolModal?.onCancelCallback)
      showExternalDataToolModal.onCancelCallback()
  }

  const handleCancelModelModal = useCallback(() => {
    setShowModelModal(null)
    if (showModelModal?.onCancelCallback)
      showModelModal.onCancelCallback()
  }, [showModelModal])

  const handleSaveModelModal = useCallback(() => {
    if (showModelModal?.onSaveCallback)
      showModelModal.onSaveCallback(showModelModal.payload)
    setShowModelModal(null)
  }, [showModelModal])

  const handleCancelExternalApiModal = useCallback(() => {
    setShowExternalKnowledgeAPIModal(null)
    if (showExternalKnowledgeAPIModal?.onCancelCallback)
      showExternalKnowledgeAPIModal.onCancelCallback()
  }, [showExternalKnowledgeAPIModal])

  const handleSaveExternalApiModal = useCallback(async (updatedFormValue: CreateExternalAPIReq) => {
    if (showExternalKnowledgeAPIModal?.onSaveCallback)
      showExternalKnowledgeAPIModal.onSaveCallback(updatedFormValue)
    setShowExternalKnowledgeAPIModal(null)
  }, [showExternalKnowledgeAPIModal])

  const handleEditExternalApiModal = useCallback(async (updatedFormValue: CreateExternalAPIReq) => {
    if (showExternalKnowledgeAPIModal?.onEditCallback)
      showExternalKnowledgeAPIModal.onEditCallback(updatedFormValue)
    setShowExternalKnowledgeAPIModal(null)
  }, [showExternalKnowledgeAPIModal])

  const handleCancelModelLoadBalancingEntryModal = useCallback(() => {
    showModelLoadBalancingEntryModal?.onCancelCallback?.()
    setShowModelLoadBalancingEntryModal(null)
  }, [showModelLoadBalancingEntryModal])

  const handleCancelOpeningModal = useCallback(() => {
    setShowOpeningModal(null)
    if (showOpeningModal?.onCancelCallback)
      showOpeningModal.onCancelCallback()
  }, [showOpeningModal])

  const handleSaveModelLoadBalancingEntryModal = useCallback((entry: ModelLoadBalancingConfigEntry) => {
    showModelLoadBalancingEntryModal?.onSaveCallback?.({
      ...showModelLoadBalancingEntryModal.payload,
      entry,
    })
    setShowModelLoadBalancingEntryModal(null)
  }, [showModelLoadBalancingEntryModal])

  const handleRemoveModelLoadBalancingEntry = useCallback(() => {
    showModelLoadBalancingEntryModal?.onRemoveCallback?.(showModelLoadBalancingEntryModal.payload)
    setShowModelLoadBalancingEntryModal(null)
  }, [showModelLoadBalancingEntryModal])

  const handleSaveApiBasedExtension = (newApiBasedExtension: ApiBasedExtension) => {
    if (showApiBasedExtensionModal?.onSaveCallback)
      showApiBasedExtensionModal.onSaveCallback(newApiBasedExtension)
    setShowApiBasedExtensionModal(null)
  }

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
    if (showOpeningModal?.onSaveCallback)
      showOpeningModal.onSaveCallback(newOpening)
    setShowOpeningModal(null)
  }

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
        {
          !!showAccountSettingModal && (
            <AccountSetting
              activeTab={showAccountSettingModal.payload}
              onCancel={handleCancelAccountSettingModal}
            />
          )
        }

        {
          !!showApiBasedExtensionModal && (
            <ApiBasedExtensionModal
              data={showApiBasedExtensionModal.payload}
              onCancel={() => setShowApiBasedExtensionModal(null)}
              onSave={handleSaveApiBasedExtension}
            />
          )
        }
        {
          !!showModerationSettingModal && (
            <ModerationSettingModal
              data={showModerationSettingModal.payload}
              onCancel={handleCancelModerationSettingModal}
              onSave={handleSaveModeration}
            />
          )
        }
        {
          !!showExternalDataToolModal && (
            <ExternalDataToolModal
              data={showExternalDataToolModal.payload}
              onCancel={handleCancelExternalDataToolModal}
              onSave={handleSaveExternalDataTool}
              onValidateBeforeSave={handleValidateBeforeSaveExternalDataTool}
            />
          )
        }

        {
          !!showPricingModal && (
            <Pricing onCancel={() => {
              if (searchParams.get('show-pricing') === '1')
                router.push(location.pathname, { forceOptimisticNavigation: true } as any)

              setShowPricingModal(false)
            }} />
          )
        }

        {
          showAnnotationFullModal && (
            <AnnotationFullModal
              show={showAnnotationFullModal}
              onHide={() => setShowAnnotationFullModal(false)} />
          )
        }
        {
          !!showModelModal && (
            <ModelModal
              provider={showModelModal.payload.currentProvider}
              configurateMethod={showModelModal.payload.currentConfigurationMethod}
              currentCustomConfigurationModelFixedFields={showModelModal.payload.currentCustomConfigurationModelFixedFields}
              onCancel={handleCancelModelModal}
              onSave={handleSaveModelModal}
            />
          )
        }
        {
          !!showExternalKnowledgeAPIModal && (
            <ExternalAPIModal
              data={showExternalKnowledgeAPIModal.payload}
              datasetBindings={showExternalKnowledgeAPIModal.datasetBindings ?? []}
              onSave={handleSaveExternalApiModal}
              onCancel={handleCancelExternalApiModal}
              onEdit={handleEditExternalApiModal}
              isEditMode={showExternalKnowledgeAPIModal.isEditMode ?? false}
            />
          )
        }
        {
          Boolean(showModelLoadBalancingModal) && (
            <ModelLoadBalancingModal {...showModelLoadBalancingModal!} />
          )
        }
        {
          !!showModelLoadBalancingEntryModal && (
            <ModelLoadBalancingEntryModal
              provider={showModelLoadBalancingEntryModal.payload.currentProvider}
              configurationMethod={showModelLoadBalancingEntryModal.payload.currentConfigurationMethod}
              currentCustomConfigurationModelFixedFields={showModelLoadBalancingEntryModal.payload.currentCustomConfigurationModelFixedFields}
              entry={showModelLoadBalancingEntryModal.payload.entry}
              onCancel={handleCancelModelLoadBalancingEntryModal}
              onSave={handleSaveModelLoadBalancingEntryModal}
              onRemove={handleRemoveModelLoadBalancingEntry}
            />
          )
        }
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

        {
          !!showUpdatePluginModal && (
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
          )
        }
      </>
    </ModalContext.Provider>
  )
}

export default ModalContext
