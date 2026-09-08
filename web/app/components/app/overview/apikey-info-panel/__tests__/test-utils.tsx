import type { DeploymentEdition } from '@dify/contracts/api/console/system-features/types.gen'
import type { AvailableModelListResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import type { RenderOptions } from '@testing-library/react'
import { fireEvent, screen } from '@testing-library/react'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import APIKeyInfoPanel from '../index'

const { mockRouterPush, mockSetSettingsDestination } = vi.hoisted(() => ({
  mockRouterPush: vi.fn(),
  mockSetSettingsDestination: vi.fn(),
}))

// Mock the modules before importing the functions

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

type MockOverrides = { hasActiveProvider?: boolean }

type APIKeyInfoPanelRenderOptions = {
  mockOverrides?: MockOverrides
} & Omit<RenderOptions, 'wrapper'>

const mainButtonName = /appOverview\.apiKeyInfo\.setAPIBtn/
let deploymentEdition: DeploymentEdition = 'COMMUNITY'

// Custom render function
function renderAPIKeyInfoPanel(options: APIKeyInfoPanelRenderOptions = {}) {
  const { mockOverrides, ...renderOptions } = options

  const queryClient = createConsoleQueryClient()
  queryClient.setQueryData(
    consoleQuery.workspaces.current.models.modelTypes.byModelType.get.queryKey({
      input: { params: { model_type: 'llm' } },
    }),
    {
      data: mockOverrides?.hasActiveProvider
        ? [
            {
              provider: 'openai',
              tenant_id: 'test-workspace',
              label: { en_US: 'OpenAI' },
              status: 'active',
              models: [],
            },
          ]
        : [],
    } satisfies AvailableModelListResponse,
  )

  return renderWithConsoleQuery(<APIKeyInfoPanel />, {
    ...renderOptions,
    queryClient,
    systemFeatures: { deployment_edition: deploymentEdition },
  })
}

// Helper functions for common test scenarios
export const scenarios = {
  // Render with API key not set (default)
  withAPIKeyNotSet: (overrides: MockOverrides = {}) =>
    renderAPIKeyInfoPanel({
      mockOverrides: {
        hasActiveProvider: false,
        ...overrides,
      },
    }),

  // Render with API key already set
  withAPIKeySet: (overrides: MockOverrides = {}) =>
    renderAPIKeyInfoPanel({
      mockOverrides: {
        hasActiveProvider: true,
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
