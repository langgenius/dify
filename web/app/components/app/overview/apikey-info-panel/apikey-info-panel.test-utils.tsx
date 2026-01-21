import type { RenderOptions } from '@testing-library/react'
import type { Mock, MockedFunction } from 'vitest'
import type { ModalContextState } from '@/context/modal-context'
import { fireEvent, render } from '@testing-library/react'
import { noop } from 'es-toolkit/function'
import { defaultPlan } from '@/app/components/billing/config'
import { useModalContext as actualUseModalContext } from '@/context/modal-context'

import { useProviderContext as actualUseProviderContext } from '@/context/provider-context'
import APIKeyInfoPanel from './index'

// Mock the modules before importing the functions
vi.mock('@/context/provider-context', () => ({
  useProviderContext: vi.fn(),
}))

vi.mock('@/context/modal-context', () => ({
  useModalContext: vi.fn(),
}))

// Type casting for mocks
const mockUseProviderContext = actualUseProviderContext as MockedFunction<typeof actualUseProviderContext>
const mockUseModalContext = actualUseModalContext as MockedFunction<typeof actualUseModalContext>

// Default mock data
const defaultProviderContext = {
  modelProviders: [],
  refreshModelProviders: noop,
  textGenerationModelList: [],
  supportRetrievalMethods: [],
  isAPIKeySet: false,
  plan: defaultPlan,
  isFetchedPlan: false,
  enableBilling: false,
  onPlanInfoChanged: noop,
  enableReplaceWebAppLogo: false,
  modelLoadBalancingEnabled: false,
  datasetOperatorEnabled: false,
  enableEducationPlan: false,
  isEducationWorkspace: false,
  isEducationAccount: false,
  allowRefreshEducationVerify: false,
  educationAccountExpireAt: null,
  isLoadingEducationAccountInfo: false,
  isFetchingEducationAccountInfo: false,
  webappCopyrightEnabled: false,
  licenseLimit: {
    workspace_members: {
      size: 0,
      limit: 0,
    },
  },
  refreshLicenseLimit: noop,
  isAllowTransferWorkspace: false,
  isAllowPublishAsCustomKnowledgePipelineTemplate: false,
}

const defaultModalContext: ModalContextState = {
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
}

export type MockOverrides = {
  providerContext?: Partial<typeof defaultProviderContext>
  modalContext?: Partial<typeof defaultModalContext>
}

export type APIKeyInfoPanelRenderOptions = {
  mockOverrides?: MockOverrides
} & Omit<RenderOptions, 'wrapper'>

// Setup function to configure mocks
export function setupMocks(overrides: MockOverrides = {}) {
  mockUseProviderContext.mockReturnValue({
    ...defaultProviderContext,
    ...overrides.providerContext,
  })

  mockUseModalContext.mockReturnValue({
    ...defaultModalContext,
    ...overrides.modalContext,
  })
}

// Custom render function
export function renderAPIKeyInfoPanel(options: APIKeyInfoPanelRenderOptions = {}) {
  const { mockOverrides, ...renderOptions } = options

  setupMocks(mockOverrides)

  return render(<APIKeyInfoPanel />, renderOptions)
}

// Helper functions for common test scenarios
export const scenarios = {
  // Render with API key not set (default)
  withAPIKeyNotSet: (overrides: MockOverrides = {}) =>
    renderAPIKeyInfoPanel({
      mockOverrides: {
        providerContext: { isAPIKeySet: false },
        ...overrides,
      },
    }),

  // Render with API key already set
  withAPIKeySet: (overrides: MockOverrides = {}) =>
    renderAPIKeyInfoPanel({
      mockOverrides: {
        providerContext: { isAPIKeySet: true },
        ...overrides,
      },
    }),

  // Render with mock modal function
  withMockModal: (mockSetShowAccountSettingModal: Mock, overrides: MockOverrides = {}) =>
    renderAPIKeyInfoPanel({
      mockOverrides: {
        modalContext: { setShowAccountSettingModal: mockSetShowAccountSettingModal },
        ...overrides,
      },
    }),
}

// Common test assertions
export const assertions = {
  // Should render main button
  shouldRenderMainButton: () => {
    const button = document.querySelector('button.btn-primary')
    expect(button).toBeInTheDocument()
    return button
  },

  // Should not render at all
  shouldNotRender: (container: HTMLElement) => {
    expect(container.firstChild).toBeNull()
  },

  // Should have correct panel styling
  shouldHavePanelStyling: (panel: HTMLElement) => {
    expect(panel).toHaveClass(
      'border-components-panel-border',
      'bg-components-panel-bg',
      'relative',
      'mb-6',
      'rounded-2xl',
      'border',
      'p-8',
      'shadow-md',
    )
  },

  // Should have close button
  shouldHaveCloseButton: (container: HTMLElement) => {
    const closeButton = container.querySelector('.absolute.right-4.top-4')
    expect(closeButton).toBeInTheDocument()
    expect(closeButton).toHaveClass('cursor-pointer')
    return closeButton
  },
}

// Common user interactions
export const interactions = {
  // Click the main button
  clickMainButton: () => {
    const button = document.querySelector('button.btn-primary')
    if (button)
      fireEvent.click(button)
    return button
  },

  // Click the close button
  clickCloseButton: (container: HTMLElement) => {
    const closeButton = container.querySelector('.absolute.right-4.top-4')
    if (closeButton)
      fireEvent.click(closeButton)
    return closeButton
  },
}

// Text content keys for assertions
export const textKeys = {
  selfHost: {
    titleRow1: /appOverview\.apiKeyInfo\.selfHost\.title\.row1/,
    titleRow2: /appOverview\.apiKeyInfo\.selfHost\.title\.row2/,
    setAPIBtn: /appOverview\.apiKeyInfo\.setAPIBtn/,
    tryCloud: /appOverview\.apiKeyInfo\.tryCloud/,
  },
  cloud: {
    trialTitle: /appOverview\.apiKeyInfo\.cloud\.trial\.title/,
    trialDescription: /appOverview\.apiKeyInfo\.cloud\.trial\.description/,
    setAPIBtn: /appOverview\.apiKeyInfo\.setAPIBtn/,
  },
}

// Setup and cleanup utilities
export function clearAllMocks() {
  vi.clearAllMocks()
}

// Export mock functions for external access
export { defaultModalContext, mockUseModalContext, mockUseProviderContext }
