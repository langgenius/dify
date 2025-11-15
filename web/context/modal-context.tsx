'use client'

import type { Dispatch, SetStateAction } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createContext, useContext, useContextSelector } from 'use-context-selector'
import { useSearchParams } from 'next/navigation'
import type {
  ConfigurationMethodEnum,
  Credential,
  CustomConfigurationModelFixedFields,
  CustomModel,
  ModelProvider,
} from '@/app/components/header/account-setting/model-provider-page/declarations'
import {
  EDUCATION_PRICING_SHOW_ACTION,
  EDUCATION_VERIFYING_LOCALSTORAGE_ITEM,
} from '@/app/education-apply/constants'
import type { AccountSettingTab } from '@/app/components/header/account-setting/constants'
import {
  ACCOUNT_SETTING_MODAL_ACTION,
  DEFAULT_ACCOUNT_SETTING_TAB,
  isValidAccountSettingTab,
} from '@/app/components/header/account-setting/constants'
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
import { removeSpecificQueryParam } from '@/utils'
import { noop } from 'lodash-es'
import dynamic from 'next/dynamic'
import type { ExpireNoticeModalPayloadProps } from '@/app/education-apply/expire-notice-modal'
import type { ModelModalModeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { NUM_INFINITE } from '@/app/components/billing/config'
import { Plan } from '@/app/components/billing/type'
import { useProviderContext } from '@/context/provider-context'
import { useAppContext } from '@/context/app-context'
import dayjs from 'dayjs'
import { IS_CLOUD_EDITION } from '@/config'

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
const OpeningSettingModal = dynamic(() => import('@/app/components/base/features/new-feature-panel/conversation-opener/modal'), {
  ssr: false,
})
const UpdatePlugin = dynamic(() => import('@/app/components/plugins/update-plugin'), {
  ssr: false,
})

const ExpireNoticeModal = dynamic(() => import('@/app/education-apply/expire-notice-modal'), {
  ssr: false,
})
const TriggerEventsLimitModal = dynamic(() => import('@/app/components/billing/trigger-events-limit-modal'), {
  ssr: false,
})

export type ModalState<T> = {
  payload: T
  onCancelCallback?: () => void
  onSaveCallback?: (newPayload?: T, formValues?: Record<string, any>) => void
  onRemoveCallback?: (newPayload?: T, formValues?: Record<string, any>) => void
  onEditCallback?: (newPayload: T) => void
  onValidateBeforeSaveCallback?: (newPayload: T) => boolean
  isEditMode?: boolean
  datasetBindings?: { id: string; name: string }[]
}

export type ModelModalType = {
  currentProvider: ModelProvider
  currentConfigurationMethod: ConfigurationMethodEnum
  currentCustomConfigurationModelFixedFields?: CustomConfigurationModelFixedFields
  isModelCredential?: boolean
  credential?: Credential
  model?: CustomModel
  mode?: ModelModalModeEnum
}

type TriggerEventsLimitModalPayload = {
  usage: number
  total: number
  resetInDays?: number
  planType: Plan
  storageKey?: string
  persistDismiss?: boolean
}

export type ModalContextState = {
  setShowAccountSettingModal: Dispatch<SetStateAction<ModalState<AccountSettingTab> | null>>
  setShowApiBasedExtensionModal: Dispatch<SetStateAction<ModalState<ApiBasedExtension> | null>>
  setShowModerationSettingModal: Dispatch<SetStateAction<ModalState<ModerationConfig> | null>>
  setShowExternalDataToolModal: Dispatch<SetStateAction<ModalState<ExternalDataTool> | null>>
  setShowPricingModal: () => void
  setShowAnnotationFullModal: () => void
  setShowModelModal: Dispatch<SetStateAction<ModalState<ModelModalType> | null>>
  setShowExternalKnowledgeAPIModal: Dispatch<SetStateAction<ModalState<CreateExternalAPIReq> | null>>
  setShowModelLoadBalancingModal: Dispatch<SetStateAction<ModelLoadBalancingModalProps | null>>
  setShowOpeningModal: Dispatch<SetStateAction<ModalState<OpeningStatement & {
    promptVariables?: PromptVariable[]
    workflowVariables?: InputVar[]
    onAutoAddPromptVariable?: (variable: PromptVariable[]) => void
  }> | null>>
  setShowUpdatePluginModal: Dispatch<SetStateAction<ModalState<UpdatePluginPayload> | null>>
  setShowEducationExpireNoticeModal: Dispatch<SetStateAction<ModalState<ExpireNoticeModalPayloadProps> | null>>
  setShowTriggerEventsLimitModal: Dispatch<SetStateAction<ModalState<TriggerEventsLimitModalPayload> | null>>
}
const PRICING_MODAL_QUERY_PARAM = 'pricing'
const PRICING_MODAL_QUERY_VALUE = 'open'

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
  setShowOpeningModal: noop,
  setShowUpdatePluginModal: noop,
  setShowEducationExpireNoticeModal: noop,
  setShowTriggerEventsLimitModal: noop,
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
  const searchParams = useSearchParams()

  const [showAccountSettingModal, setShowAccountSettingModal] = useState<ModalState<AccountSettingTab> | null>(() => {
    if (searchParams.get('action') === ACCOUNT_SETTING_MODAL_ACTION) {
      const tabParam = searchParams.get('tab')
      const tab = isValidAccountSettingTab(tabParam) ? tabParam : DEFAULT_ACCOUNT_SETTING_TAB
      return { payload: tab }
    }
    return null
  })
  const [showApiBasedExtensionModal, setShowApiBasedExtensionModal] = useState<ModalState<ApiBasedExtension> | null>(null)
  const [showModerationSettingModal, setShowModerationSettingModal] = useState<ModalState<ModerationConfig> | null>(null)
  const [showExternalDataToolModal, setShowExternalDataToolModal] = useState<ModalState<ExternalDataTool> | null>(null)
  const [showModelModal, setShowModelModal] = useState<ModalState<ModelModalType> | null>(null)
  const [showExternalKnowledgeAPIModal, setShowExternalKnowledgeAPIModal] = useState<ModalState<CreateExternalAPIReq> | null>(null)
  const [showModelLoadBalancingModal, setShowModelLoadBalancingModal] = useState<ModelLoadBalancingModalProps | null>(null)
  const [showOpeningModal, setShowOpeningModal] = useState<ModalState<OpeningStatement & {
    promptVariables?: PromptVariable[]
    workflowVariables?: InputVar[]
    onAutoAddPromptVariable?: (variable: PromptVariable[]) => void
  }> | null>(null)
  const [showUpdatePluginModal, setShowUpdatePluginModal] = useState<ModalState<UpdatePluginPayload> | null>(null)
  const [showEducationExpireNoticeModal, setShowEducationExpireNoticeModal] = useState<ModalState<ExpireNoticeModalPayloadProps> | null>(null)
  const [showTriggerEventsLimitModal, setShowTriggerEventsLimitModal] = useState<ModalState<TriggerEventsLimitModalPayload> | null>(null)
  const dismissedTriggerEventsLimitStorageKeysRef = useRef<Record<string, boolean>>({})
  const { currentWorkspace } = useAppContext()

  const [showPricingModal, setShowPricingModal] = useState(
    searchParams.get(PRICING_MODAL_QUERY_PARAM) === PRICING_MODAL_QUERY_VALUE,
  )
  const [showAnnotationFullModal, setShowAnnotationFullModal] = useState(false)
  const handleCancelAccountSettingModal = () => {
    const educationVerifying = localStorage.getItem(EDUCATION_VERIFYING_LOCALSTORAGE_ITEM)

    if (educationVerifying === 'yes')
      localStorage.removeItem(EDUCATION_VERIFYING_LOCALSTORAGE_ITEM)

    removeSpecificQueryParam('action')
    removeSpecificQueryParam('tab')
    setShowAccountSettingModal(null)
    if (showAccountSettingModal?.onCancelCallback)
      showAccountSettingModal?.onCancelCallback()
  }

  const handleAccountSettingTabChange = useCallback((tab: AccountSettingTab) => {
    setShowAccountSettingModal((prev) => {
      if (!prev)
        return { payload: tab }
      if (prev.payload === tab)
        return prev
      return { ...prev, payload: tab }
    })
  }, [setShowAccountSettingModal])

  useEffect(() => {
    if (typeof window === 'undefined')
      return
    const url = new URL(window.location.href)
    if (!showAccountSettingModal?.payload) {
      if (url.searchParams.get('action') !== ACCOUNT_SETTING_MODAL_ACTION)
        return
      url.searchParams.delete('action')
      url.searchParams.delete('tab')
      window.history.replaceState(null, '', url.toString())
      return
    }
    url.searchParams.set('action', ACCOUNT_SETTING_MODAL_ACTION)
    url.searchParams.set('tab', showAccountSettingModal.payload)
    window.history.replaceState(null, '', url.toString())
  }, [showAccountSettingModal])

  useEffect(() => {
    if (typeof window === 'undefined')
      return
    const url = new URL(window.location.href)
    if (showPricingModal) {
      url.searchParams.set(PRICING_MODAL_QUERY_PARAM, PRICING_MODAL_QUERY_VALUE)
    }
    else {
      url.searchParams.delete(PRICING_MODAL_QUERY_PARAM)
      if (url.searchParams.get('action') === EDUCATION_PRICING_SHOW_ACTION)
        url.searchParams.delete('action')
    }
    window.history.replaceState(null, '', url.toString())
  }, [showPricingModal])

  const { plan, isFetchedPlan } = useProviderContext()
  useEffect(() => {
    if (!IS_CLOUD_EDITION)
      return
    if (typeof window === 'undefined')
      return
    if (!currentWorkspace?.id)
      return
    if (!isFetchedPlan) {
      setShowTriggerEventsLimitModal(null)
      return
    }

    const { type, usage, total, reset } = plan
    const isUnlimited = total.triggerEvents === NUM_INFINITE
    const reachedLimit = total.triggerEvents > 0 && usage.triggerEvents >= total.triggerEvents

    if (type === Plan.team || isUnlimited || !reachedLimit) {
      if (showTriggerEventsLimitModal)
        setShowTriggerEventsLimitModal(null)
      return
    }

    const triggerResetInDays = type === Plan.professional && total.triggerEvents !== NUM_INFINITE
      ? reset.triggerEvents ?? undefined
      : undefined
    const cycleTag = (() => {
      if (typeof reset.triggerEvents === 'number')
        return dayjs().startOf('day').add(reset.triggerEvents, 'day').format('YYYY-MM-DD')
      if (type === Plan.sandbox)
        return dayjs().endOf('month').format('YYYY-MM-DD')
      return 'none'
    })()
    const storageKey = `trigger-events-limit-dismissed-${currentWorkspace.id}-${type}-${total.triggerEvents}-${cycleTag}`
    if (dismissedTriggerEventsLimitStorageKeysRef.current[storageKey])
      return

    let persistDismiss = true
    let hasDismissed = false
    try {
      if (localStorage.getItem(storageKey) === '1')
        hasDismissed = true
    }
    catch {
      persistDismiss = false
    }
    if (hasDismissed)
      return

    if (showTriggerEventsLimitModal?.payload.storageKey === storageKey)
      return

    setShowTriggerEventsLimitModal({
      payload: {
        usage: usage.triggerEvents,
        total: total.triggerEvents,
        planType: type,
        resetInDays: triggerResetInDays,
        storageKey,
        persistDismiss,
      },
    })
  }, [plan, isFetchedPlan, showTriggerEventsLimitModal, currentWorkspace?.id])

  const persistTriggerEventsLimitModalDismiss = () => {
    const storageKey = showTriggerEventsLimitModal?.payload.storageKey
    if (!storageKey)
      return
    if (showTriggerEventsLimitModal?.payload.persistDismiss) {
      try {
        localStorage.setItem(storageKey, '1')
        return
      }
      catch {
        // ignore error and fall back to in-memory guard
      }
    }
    dismissedTriggerEventsLimitStorageKeysRef.current[storageKey] = true
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

  const handleSaveModelModal = useCallback((formValues?: Record<string, any>) => {
    if (showModelModal?.onSaveCallback)
      showModelModal.onSaveCallback(showModelModal.payload, formValues)
    setShowModelModal(null)
  }, [showModelModal])

  const handleRemoveModelModal = useCallback((formValues?: Record<string, any>) => {
    if (showModelModal?.onRemoveCallback)
      showModelModal.onRemoveCallback(showModelModal.payload, formValues)
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

  const handleCancelOpeningModal = useCallback(() => {
    setShowOpeningModal(null)
    if (showOpeningModal?.onCancelCallback)
      showOpeningModal.onCancelCallback()
  }, [showOpeningModal])

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

  const handleShowPricingModal = useCallback(() => {
    setShowPricingModal(true)
  }, [])

  const handleCancelPricingModal = useCallback(() => {
    setShowPricingModal(false)
  }, [])

  return (
    <ModalContext.Provider value={{
      setShowAccountSettingModal,
      setShowApiBasedExtensionModal,
      setShowModerationSettingModal,
      setShowExternalDataToolModal,
      setShowPricingModal: handleShowPricingModal,
      setShowAnnotationFullModal: () => setShowAnnotationFullModal(true),
      setShowModelModal,
      setShowExternalKnowledgeAPIModal,
      setShowModelLoadBalancingModal,
      setShowOpeningModal,
      setShowUpdatePluginModal,
      setShowEducationExpireNoticeModal,
      setShowTriggerEventsLimitModal,
    }}>
      <>
        {children}
        {
          !!showAccountSettingModal && (
            <AccountSetting
              activeTab={showAccountSettingModal.payload}
              onCancel={handleCancelAccountSettingModal}
              onTabChange={handleAccountSettingTabChange}
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
            <Pricing onCancel={handleCancelPricingModal} />
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
              isModelCredential={showModelModal.payload.isModelCredential}
              credential={showModelModal.payload.credential}
              model={showModelModal.payload.model}
              mode={showModelModal.payload.mode}
              onCancel={handleCancelModelModal}
              onSave={handleSaveModelModal}
              onRemove={handleRemoveModelModal}
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
        {
          !!showEducationExpireNoticeModal && (
            <ExpireNoticeModal
              {...showEducationExpireNoticeModal.payload}
              onClose={() => setShowEducationExpireNoticeModal(null)}
            />
          )}
        {
          !!showTriggerEventsLimitModal && (
            <TriggerEventsLimitModal
              show
              usage={showTriggerEventsLimitModal.payload.usage}
              total={showTriggerEventsLimitModal.payload.total}
              planType={showTriggerEventsLimitModal.payload.planType}
              resetInDays={showTriggerEventsLimitModal.payload.resetInDays}
              onDismiss={() => {
                persistTriggerEventsLimitModalDismiss()
                setShowTriggerEventsLimitModal(null)
              }}
              onUpgrade={() => {
                persistTriggerEventsLimitModalDismiss()
                setShowTriggerEventsLimitModal(null)
                handleShowPricingModal()
              }}
            />
          )}
      </>
    </ModalContext.Provider>
  )
}

export default ModalContext
