import type { DeploymentEdition } from '@dify/contracts/api/console/system-features/types.gen'
import type { RenderOptions } from '@testing-library/react'
import type { MockedFunction } from 'vite-plus/test'
import { fireEvent, screen } from '@testing-library/react'
import { noop } from 'es-toolkit/function'
import { defaultPlan } from '@/app/components/billing/config'
import { useProviderContext as actualUseProviderContext } from '@/context/provider-context'
import { renderWithConsoleQuery } from '@/test/console/query-data'
import APIKeyInfoPanel from '../index'

const { mockRouterPush, mockSetSettingsDestination } = vi.hoisted(() => ({
  mockRouterPush: vi.fn(),
  mockSetSettingsDestination: vi.fn(),
}))

// Mock the modules before importing the functions
vi.mock('@/context/provider-context', () => ({
  useProviderContext: vi.fn(),
}))

vi.mock('nuqs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('nuqs')>()
  return {
    ...actual,
    useQueryState: () => [null, mockSetSettingsDestination],
  }
})

vi.mock('@/next/navigation', () => ({
  useRouter: () => ({
    push: mockRouterPush,
  }),
}))

// Type casting for mocks
const mockUseProviderContext = actualUseProviderContext as MockedFunction<
  typeof actualUseProviderContext
>
// Default mock data
const defaultProviderContext = {
  modelProviders: [],
  modelProviderPlugins: {},
  refreshModelProviders: async () => {},
  isLoadingModelProviders: false,
  isSuccessModelProviders: false,
  textGenerationModelList: [],
  supportRetrievalMethods: [],
  isAPIKeySet: false,
  plan: defaultPlan,
  isFetchedPlan: false,
  isFetchedPlanInfo: false,
  enableBilling: false,
  onPlanInfoChanged: noop,
  enableReplaceWebAppLogo: false,
  modelLoadBalancingEnabled: false,
  enableEducationPlan: false,
  webappCopyrightEnabled: false,
  isAllowTransferWorkspace: false,
  isAllowPublishAsCustomKnowledgePipelineTemplate: false,
  humanInputEmailDeliveryEnabled: false,
}

type MockOverrides = {
  providerContext?: Partial<typeof defaultProviderContext>
}

type APIKeyInfoPanelRenderOptions = {
  mockOverrides?: MockOverrides
} & Omit<RenderOptions, 'wrapper'>

const mainButtonName = /appOverview\.apiKeyInfo\.setAPIBtn/
let deploymentEdition: DeploymentEdition = 'COMMUNITY'

// Setup function to configure mocks
function setupMocks(overrides: MockOverrides = {}) {
  mockUseProviderContext.mockReturnValue({
    ...defaultProviderContext,
    ...overrides.providerContext,
  })
}

// Custom render function
function renderAPIKeyInfoPanel(options: APIKeyInfoPanelRenderOptions = {}) {
  const { mockOverrides, ...renderOptions } = options

  setupMocks(mockOverrides)

  return renderWithConsoleQuery(<APIKeyInfoPanel />, {
    ...renderOptions,
    systemFeatures: { deployment_edition: deploymentEdition },
  })
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
}

// Common user interactions
export const interactions = {
  // Click the main button
  clickMainButton: () => {
    const button = screen.getByRole('button', { name: mainButtonName })
    fireEvent.click(button)
    return button
  },

  // Click the close button
  clickCloseButton: (container: HTMLElement) => {
    const closeButton = container.querySelector('.absolute.right-4.top-4')
    if (closeButton) fireEvent.click(closeButton)
    return closeButton
  },
}

// Text content keys for assertions
export const textKeys = {
  button: mainButtonName,
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

export function setDeploymentEdition(value: DeploymentEdition) {
  deploymentEdition = value
}

// Export mock functions for external access
export { mockSetSettingsDestination }
