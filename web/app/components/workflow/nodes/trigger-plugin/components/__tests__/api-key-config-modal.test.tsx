import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useTranslation } from 'react-i18next'

jest.mock('react-i18next')
jest.mock('@/service/use-triggers', () => ({
  useCreateTriggerSubscriptionBuilder: () => ({ mutateAsync: jest.fn().mockResolvedValue({ subscription_builder: { id: 'test-id' } }) }),
  useUpdateTriggerSubscriptionBuilder: () => ({ mutateAsync: jest.fn() }),
  useVerifyTriggerSubscriptionBuilder: () => ({ mutateAsync: jest.fn() }),
  useBuildTriggerSubscription: () => ({ mutateAsync: jest.fn() }),
  useInvalidateTriggerSubscriptions: () => jest.fn(),
}))
jest.mock('@/app/components/base/toast', () => ({
  useToastContext: () => ({ notify: jest.fn() }),
}))
jest.mock('@/app/components/tools/utils/to-form-schema', () => ({
  toolCredentialToFormSchemas: jest.fn().mockReturnValue([
    {
      name: 'api_key',
      label: { en_US: 'API Key' },
      required: true,
    },
  ]),
  addDefaultValue: jest.fn().mockReturnValue({ api_key: '' }),
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

import ApiKeyConfigModal from '../api-key-config-modal'

const mockUseTranslation = useTranslation as jest.MockedFunction<typeof useTranslation>

const mockTranslation = {
  t: (key: string, params?: any) => {
    const translations: Record<string, string> = {
      'workflow.nodes.triggerPlugin.configureApiKey': 'Configure API Key',
      'workflow.nodes.triggerPlugin.apiKeyDescription': 'Configure API key credentials for authentication',
      'workflow.nodes.triggerPlugin.apiKeyConfigured': 'API key configured successfully',
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
  credentials_schema: [
    {
      type: 'secret-input' as const,
      name: 'api_key',
      required: true,
      label: { en_US: 'API Key' },
      scope: null,
      default: null,
      options: null,
      help: null,
      url: null,
      placeholder: null,
    },
  ],
  oauth_client_schema: [],
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

describe('ApiKeyConfigModal', () => {
  const mockProps = {
    provider: mockProvider,
    onCancel: jest.fn(),
    onSuccess: jest.fn(),
  }

  describe('Rendering', () => {
    it('should render modal with correct title and description', () => {
      render(<ApiKeyConfigModal {...mockProps} />)

      expect(screen.getByText('Configure API Key')).toBeInTheDocument()
      expect(screen.getByText('Configure API key credentials for authentication')).toBeInTheDocument()
    })

    it('should render form when credential schema is loaded', async () => {
      render(<ApiKeyConfigModal {...mockProps} />)

      await waitFor(() => {
        expect(screen.getByTestId('mock-form')).toBeInTheDocument()
      })
    })

    it('should render form fields with correct labels', async () => {
      render(<ApiKeyConfigModal {...mockProps} />)

      await waitFor(() => {
        expect(screen.getByLabelText('API Key')).toBeInTheDocument()
      })
    })

    it('should render cancel and save buttons', async () => {
      render(<ApiKeyConfigModal {...mockProps} />)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()
      })
    })
  })

  describe('Form Interaction', () => {
    it('should update form values on input change', async () => {
      render(<ApiKeyConfigModal {...mockProps} />)

      await waitFor(() => {
        const apiKeyInput = screen.getByTestId('input-api_key')
        fireEvent.change(apiKeyInput, { target: { value: 'test-api-key' } })
        expect(apiKeyInput).toHaveValue('test-api-key')
      })
    })

    it('should call onCancel when cancel button is clicked', async () => {
      render(<ApiKeyConfigModal {...mockProps} />)

      await waitFor(() => {
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
        expect(mockProps.onCancel).toHaveBeenCalledTimes(1)
      })
    })
  })

  describe('Save Process', () => {
    it('should proceed with save when required fields are filled', async () => {
      render(<ApiKeyConfigModal {...mockProps} />)

      await waitFor(() => {
        const apiKeyInput = screen.getByTestId('input-api_key')
        fireEvent.change(apiKeyInput, { target: { value: 'valid-api-key' } })
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
