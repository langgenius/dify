import type { CreateExternalAPIReq, FormSchema } from '../declarations'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Form from './Form'

// Mock context for i18n doc link
vi.mock('@/context/i18n', () => ({
  useDocLink: () => (path: string) => `https://docs.example.com${path}`,
}))

describe('Form', () => {
  const defaultFormSchemas: FormSchema[] = [
    {
      variable: 'name',
      type: 'text',
      label: { en_US: 'Name', zh_CN: '名称' },
      required: true,
    },
    {
      variable: 'endpoint',
      type: 'text',
      label: { en_US: 'API Endpoint', zh_CN: 'API 端点' },
      required: true,
    },
    {
      variable: 'api_key',
      type: 'secret',
      label: { en_US: 'API Key', zh_CN: 'API 密钥' },
      required: true,
    },
  ]

  const defaultValue: CreateExternalAPIReq = {
    name: '',
    settings: {
      endpoint: '',
      api_key: '',
    },
  }

  const defaultProps = {
    value: defaultValue,
    onChange: vi.fn(),
    formSchemas: defaultFormSchemas,
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render without crashing', () => {
      const { container } = render(<Form {...defaultProps} />)
      expect(container.querySelector('form')).toBeInTheDocument()
    })

    it('should render all form fields based on formSchemas', () => {
      render(<Form {...defaultProps} />)
      expect(screen.getByLabelText(/name/i)).toBeInTheDocument()
      expect(screen.getByLabelText(/api endpoint/i)).toBeInTheDocument()
      expect(screen.getByLabelText(/api key/i)).toBeInTheDocument()
    })

    it('should render required indicator for required fields', () => {
      render(<Form {...defaultProps} />)
      const labels = screen.getAllByText('*')
      expect(labels.length).toBe(3) // All 3 fields are required
    })

    it('should render documentation link for endpoint field', () => {
      render(<Form {...defaultProps} />)
      const docLink = screen.getByText('dataset.externalAPIPanelDocumentation')
      expect(docLink).toBeInTheDocument()
      expect(docLink.closest('a')).toHaveAttribute('href', expect.stringContaining('docs.example.com'))
    })

    it('should render password type input for secret fields', () => {
      render(<Form {...defaultProps} />)
      const apiKeyInput = screen.getByLabelText(/api key/i)
      expect(apiKeyInput).toHaveAttribute('type', 'password')
    })

    it('should render text type input for text fields', () => {
      render(<Form {...defaultProps} />)
      const nameInput = screen.getByLabelText(/name/i)
      expect(nameInput).toHaveAttribute('type', 'text')
    })
  })

  describe('Props', () => {
    it('should apply custom className to form', () => {
      const { container } = render(<Form {...defaultProps} className="custom-form-class" />)
      expect(container.querySelector('form')).toHaveClass('custom-form-class')
    })

    it('should apply itemClassName to form items', () => {
      const { container } = render(<Form {...defaultProps} itemClassName="custom-item-class" />)
      const items = container.querySelectorAll('.custom-item-class')
      expect(items.length).toBe(3)
    })

    it('should apply fieldLabelClassName to labels', () => {
      const { container } = render(<Form {...defaultProps} fieldLabelClassName="custom-label-class" />)
      const labels = container.querySelectorAll('label.custom-label-class')
      expect(labels.length).toBe(3)
    })

    it('should apply inputClassName to inputs', () => {
      render(<Form {...defaultProps} inputClassName="custom-input-class" />)
      const inputs = screen.getAllByRole('textbox')
      inputs.forEach((input) => {
        expect(input).toHaveClass('custom-input-class')
      })
    })

    it('should display initial values', () => {
      const valueWithData: CreateExternalAPIReq = {
        name: 'Test API',
        settings: {
          endpoint: 'https://api.example.com',
          api_key: 'secret-key',
        },
      }
      render(<Form {...defaultProps} value={valueWithData} />)
      expect(screen.getByLabelText(/name/i)).toHaveValue('Test API')
      expect(screen.getByLabelText(/api endpoint/i)).toHaveValue('https://api.example.com')
      expect(screen.getByLabelText(/api key/i)).toHaveValue('secret-key')
    })
  })

  describe('User Interactions', () => {
    it('should call onChange when name field changes', () => {
      const onChange = vi.fn()
      render(<Form {...defaultProps} onChange={onChange} />)

      const nameInput = screen.getByLabelText(/name/i)
      fireEvent.change(nameInput, { target: { value: 'New API Name' } })

      expect(onChange).toHaveBeenCalledWith({
        name: 'New API Name',
        settings: { endpoint: '', api_key: '' },
      })
    })

    it('should call onChange when endpoint field changes', () => {
      const onChange = vi.fn()
      render(<Form {...defaultProps} onChange={onChange} />)

      const endpointInput = screen.getByLabelText(/api endpoint/i)
      fireEvent.change(endpointInput, { target: { value: 'https://new-api.example.com' } })

      expect(onChange).toHaveBeenCalledWith({
        name: '',
        settings: { endpoint: 'https://new-api.example.com', api_key: '' },
      })
    })

    it('should call onChange when api_key field changes', () => {
      const onChange = vi.fn()
      render(<Form {...defaultProps} onChange={onChange} />)

      const apiKeyInput = screen.getByLabelText(/api key/i)
      fireEvent.change(apiKeyInput, { target: { value: 'new-secret-key' } })

      expect(onChange).toHaveBeenCalledWith({
        name: '',
        settings: { endpoint: '', api_key: 'new-secret-key' },
      })
    })

    it('should update settings without affecting name', () => {
      const onChange = vi.fn()
      const initialValue: CreateExternalAPIReq = {
        name: 'Existing Name',
        settings: { endpoint: '', api_key: '' },
      }
      render(<Form {...defaultProps} value={initialValue} onChange={onChange} />)

      const endpointInput = screen.getByLabelText(/api endpoint/i)
      fireEvent.change(endpointInput, { target: { value: 'https://api.example.com' } })

      expect(onChange).toHaveBeenCalledWith({
        name: 'Existing Name',
        settings: { endpoint: 'https://api.example.com', api_key: '' },
      })
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty formSchemas', () => {
      const { container } = render(<Form {...defaultProps} formSchemas={[]} />)
      expect(container.querySelector('form')).toBeInTheDocument()
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    })

    it('should handle optional field (required: false)', () => {
      const schemasWithOptional: FormSchema[] = [
        {
          variable: 'description',
          type: 'text',
          label: { en_US: 'Description' },
          required: false,
        },
      ]
      render(<Form {...defaultProps} formSchemas={schemasWithOptional} />)
      expect(screen.queryByText('*')).not.toBeInTheDocument()
    })

    it('should fallback to en_US label when current language label is not available', () => {
      const schemasWithEnOnly: FormSchema[] = [
        {
          variable: 'test',
          type: 'text',
          label: { en_US: 'Test Field' },
          required: false,
        },
      ]
      render(<Form {...defaultProps} formSchemas={schemasWithEnOnly} />)
      expect(screen.getByLabelText(/test field/i)).toBeInTheDocument()
    })

    it('should preserve existing settings when updating one field', () => {
      const onChange = vi.fn()
      const initialValue: CreateExternalAPIReq = {
        name: '',
        settings: { endpoint: 'https://existing.com', api_key: 'existing-key' },
      }
      render(<Form {...defaultProps} value={initialValue} onChange={onChange} />)

      const endpointInput = screen.getByLabelText(/api endpoint/i)
      fireEvent.change(endpointInput, { target: { value: 'https://new.com' } })

      expect(onChange).toHaveBeenCalledWith({
        name: '',
        settings: { endpoint: 'https://new.com', api_key: 'existing-key' },
      })
    })
  })
})
