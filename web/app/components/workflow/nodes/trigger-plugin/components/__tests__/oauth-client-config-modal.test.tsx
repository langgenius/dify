import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useTranslation } from 'react-i18next'

jest.mock('react-i18next')
jest.mock('@/service/use-triggers', () => ({
  useConfigureTriggerOAuth: () => ({ mutateAsync: jest.fn() }),
  useInvalidateTriggerOAuthConfig: () => jest.fn(),
  useTriggerOAuthConfig: () => ({ data: null, isLoading: false }),
}))
jest.mock('@/app/components/base/toast', () => ({
  useToastContext: () => ({ notify: jest.fn() }),
}))
jest.mock('@/app/components/tools/utils/to-form-schema', () => ({
  toolCredentialToFormSchemas: jest.fn().mockReturnValue([
    {
      name: 'client_id',
      label: { en_US: 'Client ID' },
      required: true,
    },
    {
      name: 'client_secret',
      label: { en_US: 'Client Secret' },
      required: true,
    },
  ]),
  addDefaultValue: jest.fn().mockReturnValue({ client_id: '', client_secret: '' }),
}))
jest.mock('@/app/components/header/account-setting/model-provider-page/hooks', () => ({
  useLanguage: () => 'en_US',
}))
jest.mock('@/app/components/header/account-setting/model-provider-page/model-modal/Form', () => {
  return function MockForm({ value, onChange, formSchemas }: any) {
    return (
      <div data-testid="mock-form">
        {formSchemas.map((schema: any, index: number) => (
          <div key={index}>
            <label htmlFor={schema.name}>{schema.label?.en_US || schema.name}</label>
            <input
              id={schema.name}
              data-testid={`input-${schema.name}`}
              value={value[schema.name] || ''}
              onChange={e => onChange({ ...value, [schema.name]: e.target.value })}
            />
          </div>
        ))}
      </div>
    )
  }
})

import OAuthClientConfigModal from '../oauth-client-config-modal'

const mockUseTranslation = useTranslation as jest.MockedFunction<typeof useTranslation>

const mockTranslation = {
  t: (key: string, params?: any) => {
    const translations: Record<string, string> = {
      'workflow.nodes.triggerPlugin.configureOAuthClient': 'Configure OAuth Client',
      'workflow.nodes.triggerPlugin.oauthClientDescription': 'Configure OAuth client credentials to enable authentication',
      'workflow.nodes.triggerPlugin.oauthClientSaved': 'OAuth client configuration saved successfully',
      'workflow.nodes.triggerPlugin.configurationFailed': 'Configuration failed',
      'common.operation.cancel': 'Cancel',
      'common.operation.save': 'Save',
      'common.errorMsg.fieldRequired': `${params?.field} is required`,
    }
    return translations[key] || key
  },
}

const mockProvider = {
  plugin_id: 'test-plugin',
  name: 'test-provider',
  author: 'test',
  label: { en_US: 'Test Provider' },
  description: { en_US: 'Test Description' },
  icon: 'test-icon.svg',
  icon_dark: null,
  tags: ['test'],
  plugin_unique_identifier: 'test:1.0.0',
  credentials_schema: [],
  oauth_client_schema: [
    {
      type: 'secret-input' as const,
      name: 'client_id',
      required: true,
      label: { en_US: 'Client ID' },
      scope: null,
      default: null,
      options: null,
      help: null,
      url: null,
      placeholder: null,
    },
    {
      type: 'secret-input' as const,
      name: 'client_secret',
      required: true,
      label: { en_US: 'Client Secret' },
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
  jest.clearAllMocks()
})

describe('OAuthClientConfigModal', () => {
  const mockProps = {
    provider: mockProvider,
    onCancel: jest.fn(),
    onSuccess: jest.fn(),
  }

  describe('Rendering', () => {
    it('should render modal with correct title and description', () => {
      render(<OAuthClientConfigModal {...mockProps} />)

      expect(screen.getByText('Configure OAuth Client')).toBeInTheDocument()
      expect(screen.getByText('Configure OAuth client credentials to enable authentication')).toBeInTheDocument()
    })

    it('should render form when schema is loaded', async () => {
      render(<OAuthClientConfigModal {...mockProps} />)

      await waitFor(() => {
        expect(screen.getByTestId('mock-form')).toBeInTheDocument()
      })
    })

    it('should render form fields with correct labels', async () => {
      render(<OAuthClientConfigModal {...mockProps} />)

      await waitFor(() => {
        expect(screen.getByLabelText('Client ID')).toBeInTheDocument()
        expect(screen.getByLabelText('Client Secret')).toBeInTheDocument()
      })
    })

    it('should render cancel and save buttons', async () => {
      render(<OAuthClientConfigModal {...mockProps} />)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()
      })
    })
  })

  describe('Form Interaction', () => {
    it('should update form values on input change', async () => {
      render(<OAuthClientConfigModal {...mockProps} />)

      await waitFor(() => {
        const clientIdInput = screen.getByTestId('input-client_id')
        fireEvent.change(clientIdInput, { target: { value: 'test-client-id' } })
        expect(clientIdInput).toHaveValue('test-client-id')
      })
    })

    it('should call onCancel when cancel button is clicked', async () => {
      render(<OAuthClientConfigModal {...mockProps} />)

      await waitFor(() => {
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
        expect(mockProps.onCancel).toHaveBeenCalledTimes(1)
      })
    })
  })

  describe('Save Process', () => {
    it('should proceed with save when required fields are filled', async () => {
      render(<OAuthClientConfigModal {...mockProps} />)

      await waitFor(() => {
        const clientIdInput = screen.getByTestId('input-client_id')
        const clientSecretInput = screen.getByTestId('input-client_secret')

        fireEvent.change(clientIdInput, { target: { value: 'valid-client-id' } })
        fireEvent.change(clientSecretInput, { target: { value: 'valid-client-secret' } })
      })

      await waitFor(() => {
        fireEvent.click(screen.getByRole('button', { name: 'Save' }))
      })

      await waitFor(() => {
        expect(mockProps.onSuccess).toHaveBeenCalledTimes(1)
      })
    })
  })
})
