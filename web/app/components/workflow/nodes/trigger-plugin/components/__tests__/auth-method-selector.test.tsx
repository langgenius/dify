import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { useTranslation } from 'react-i18next'

jest.mock('react-i18next')
jest.mock('@/service/use-triggers', () => ({
  useInitiateTriggerOAuth: () => ({ mutateAsync: jest.fn() }),
  useInvalidateTriggerSubscriptions: () => jest.fn(),
  useTriggerOAuthConfig: () => ({ data: null }),
}))
jest.mock('@/hooks/use-oauth', () => ({
  openOAuthPopup: jest.fn(),
}))
jest.mock('@/app/components/base/toast', () => ({
  useToastContext: () => ({ notify: jest.fn() }),
}))
jest.mock('../api-key-config-modal', () => {
  return function MockApiKeyConfigModal({ onCancel }: any) {
    return (
      <div data-testid="api-key-modal">
        <button onClick={onCancel}>Cancel</button>
      </div>
    )
  }
})
jest.mock('../oauth-client-config-modal', () => {
  return function MockOAuthClientConfigModal({ onCancel }: any) {
    return (
      <div data-testid="oauth-client-modal">
        <button onClick={onCancel}>Cancel</button>
      </div>
    )
  }
})

import AuthMethodSelector from '../auth-method-selector'

const mockUseTranslation = useTranslation as jest.MockedFunction<typeof useTranslation>

const mockTranslation = {
  t: (key: string) => {
    const translations: Record<string, string> = {
      'workflow.nodes.triggerPlugin.or': 'OR',
      'workflow.nodes.triggerPlugin.useOAuth': 'Use OAuth',
      'workflow.nodes.triggerPlugin.useApiKey': 'Use API Key',
    }
    return translations[key] || key
  },
}

const mockProvider = {
  plugin_id: 'test-plugin',
  name: 'test-provider',
  author: 'test',
  label: { en_US: 'Test Provider', zh_Hans: '测试提供者' },
  description: { en_US: 'Test Description', zh_Hans: '测试描述' },
  icon: 'test-icon.svg',
  icon_dark: null,
  tags: ['test'],
  plugin_unique_identifier: 'test:1.0.0',
  credentials_schema: [
    {
      type: 'secret-input' as const,
      name: 'api_key',
      required: true,
      label: { en_US: 'API Key', zh_Hans: 'API密钥' },
      scope: null,
      default: null,
      options: null,
      help: null,
      url: null,
      placeholder: null,
    },
  ],
  oauth_client_schema: [
    {
      type: 'secret-input' as const,
      name: 'client_id',
      required: true,
      label: { en_US: 'Client ID', zh_Hans: '客户端ID' },
      scope: null,
      default: null,
      options: null,
      help: null,
      url: null,
      placeholder: null,
    },
  ],
  subscription_schema: {
    parameters_schema: [],
    properties_schema: [],
  },
  triggers: [],
}

beforeEach(() => {
  mockUseTranslation.mockReturnValue(mockTranslation as any)
})

describe('AuthMethodSelector', () => {
  describe('Rendering', () => {
    it('should not render when no supported methods are available', () => {
      const { container } = render(
        <AuthMethodSelector
          provider={mockProvider}
          supportedMethods={[]}
        />,
      )

      expect(container.firstChild).toBeNull()
    })

    it('should render OAuth button when oauth is supported', () => {
      render(
        <AuthMethodSelector
          provider={mockProvider}
          supportedMethods={['oauth']}
        />,
      )

      expect(screen.getByRole('button', { name: 'Use OAuth' })).toBeInTheDocument()
    })

    it('should render API Key button when api_key is supported', () => {
      render(
        <AuthMethodSelector
          provider={mockProvider}
          supportedMethods={['api_key']}
        />,
      )

      expect(screen.getByRole('button', { name: 'Use API Key' })).toBeInTheDocument()
    })

    it('should render both buttons and OR divider when both methods are supported', () => {
      render(
        <AuthMethodSelector
          provider={mockProvider}
          supportedMethods={['oauth', 'api_key']}
        />,
      )

      expect(screen.getByRole('button', { name: 'Use OAuth' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Use API Key' })).toBeInTheDocument()
      expect(screen.getByText('OR')).toBeInTheDocument()
    })
  })

  describe('Modal Interactions', () => {
    it('should open API Key modal when API Key button is clicked', () => {
      render(
        <AuthMethodSelector
          provider={mockProvider}
          supportedMethods={['api_key']}
        />,
      )

      fireEvent.click(screen.getByRole('button', { name: 'Use API Key' }))
      expect(screen.getByTestId('api-key-modal')).toBeInTheDocument()
    })

    it('should close API Key modal when cancel is clicked', () => {
      render(
        <AuthMethodSelector
          provider={mockProvider}
          supportedMethods={['api_key']}
        />,
      )

      fireEvent.click(screen.getByRole('button', { name: 'Use API Key' }))
      expect(screen.getByTestId('api-key-modal')).toBeInTheDocument()

      fireEvent.click(screen.getByText('Cancel'))
      expect(screen.queryByTestId('api-key-modal')).not.toBeInTheDocument()
    })

    it('should open OAuth client config modal when OAuth settings button is clicked', () => {
      render(
        <AuthMethodSelector
          provider={mockProvider}
          supportedMethods={['oauth']}
        />,
      )

      const settingsButtons = screen.getAllByRole('button')
      const settingsButton = settingsButtons.find(button =>
        button.querySelector('svg') && !button.textContent?.includes('Use OAuth'),
      )

      fireEvent.click(settingsButton!)
      expect(screen.getByTestId('oauth-client-modal')).toBeInTheDocument()
    })
  })
})
