import type { FormSchema } from '../../base/form/types'
import type { PluginDetail } from '../types'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Toast from '@/app/components/base/toast'
import EndpointModal from './endpoint-modal'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (opts?.field)
        return `${key}: ${opts.field}`
      return key
    },
  }),
}))

vi.mock('@/hooks/use-i18n', () => ({
  useRenderI18nObject: () => (obj: Record<string, string> | string) =>
    typeof obj === 'string' ? obj : obj?.en_US || '',
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/model-modal/Form', () => ({
  default: ({ value, onChange, fieldMoreInfo }: {
    value: Record<string, unknown>
    onChange: (v: Record<string, unknown>) => void
    fieldMoreInfo?: (item: { url?: string }) => React.ReactNode
  }) => {
    return (
      <div data-testid="form">
        <input
          data-testid="form-input"
          value={value.name as string || ''}
          onChange={e => onChange({ ...value, name: e.target.value })}
        />
        {/* Render fieldMoreInfo to test url link */}
        {fieldMoreInfo && (
          <div data-testid="field-more-info">
            {fieldMoreInfo({ url: 'https://example.com' })}
            {fieldMoreInfo({})}
          </div>
        )}
      </div>
    )
  },
}))

vi.mock('../readme-panel/entrance', () => ({
  ReadmeEntrance: () => <div data-testid="readme-entrance" />,
}))

const mockFormSchemas = [
  { name: 'name', label: { en_US: 'Name' }, type: 'text-input', required: true, default: '' },
  { name: 'apiKey', label: { en_US: 'API Key' }, type: 'secret-input', required: false, default: '' },
] as unknown as FormSchema[]

const mockPluginDetail: PluginDetail = {
  id: 'test-id',
  created_at: '2024-01-01',
  updated_at: '2024-01-02',
  name: 'Test Plugin',
  plugin_id: 'test-plugin',
  plugin_unique_identifier: 'test-uid',
  declaration: {} as PluginDetail['declaration'],
  installation_id: 'install-1',
  tenant_id: 'tenant-1',
  endpoints_setups: 0,
  endpoints_active: 0,
  version: '1.0.0',
  latest_version: '1.0.0',
  latest_unique_identifier: 'test-uid',
  source: 'marketplace' as PluginDetail['source'],
  meta: undefined,
  status: 'active',
  deprecated_reason: '',
  alternative_plugin_id: '',
}

describe('EndpointModal', () => {
  const mockOnCancel = vi.fn()
  const mockOnSaved = vi.fn()
  let mockToastNotify: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    mockToastNotify = vi.spyOn(Toast, 'notify').mockImplementation(() => ({ clear: vi.fn() }))
  })

  describe('Rendering', () => {
    it('should render drawer', () => {
      render(
        <EndpointModal
          formSchemas={mockFormSchemas}
          onCancel={mockOnCancel}
          onSaved={mockOnSaved}
          pluginDetail={mockPluginDetail}
        />,
      )

      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    it('should render title and description', () => {
      render(
        <EndpointModal
          formSchemas={mockFormSchemas}
          onCancel={mockOnCancel}
          onSaved={mockOnSaved}
          pluginDetail={mockPluginDetail}
        />,
      )

      expect(screen.getByText('detailPanel.endpointModalTitle')).toBeInTheDocument()
      expect(screen.getByText('detailPanel.endpointModalDesc')).toBeInTheDocument()
    })

    it('should render form with fieldMoreInfo url link', () => {
      render(
        <EndpointModal
          formSchemas={mockFormSchemas}
          onCancel={mockOnCancel}
          onSaved={mockOnSaved}
          pluginDetail={mockPluginDetail}
        />,
      )

      expect(screen.getByTestId('field-more-info')).toBeInTheDocument()
      // Should render the "howToGet" link when url exists
      expect(screen.getByText('howToGet')).toBeInTheDocument()
    })

    it('should render readme entrance', () => {
      render(
        <EndpointModal
          formSchemas={mockFormSchemas}
          onCancel={mockOnCancel}
          onSaved={mockOnSaved}
          pluginDetail={mockPluginDetail}
        />,
      )

      expect(screen.getByTestId('readme-entrance')).toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    it('should call onCancel when cancel clicked', () => {
      render(
        <EndpointModal
          formSchemas={mockFormSchemas}
          onCancel={mockOnCancel}
          onSaved={mockOnSaved}
          pluginDetail={mockPluginDetail}
        />,
      )

      fireEvent.click(screen.getByRole('button', { name: 'operation.cancel' }))

      expect(mockOnCancel).toHaveBeenCalledTimes(1)
    })

    it('should call onCancel when close button clicked', () => {
      render(
        <EndpointModal
          formSchemas={mockFormSchemas}
          onCancel={mockOnCancel}
          onSaved={mockOnSaved}
          pluginDetail={mockPluginDetail}
        />,
      )

      // Find the close button (ActionButton with RiCloseLine icon)
      const allButtons = screen.getAllByRole('button')
      const closeButton = allButtons.find(btn => btn.classList.contains('action-btn'))
      if (closeButton)
        fireEvent.click(closeButton)

      expect(mockOnCancel).toHaveBeenCalledTimes(1)
    })

    it('should update form value when input changes', () => {
      render(
        <EndpointModal
          formSchemas={mockFormSchemas}
          onCancel={mockOnCancel}
          onSaved={mockOnSaved}
          pluginDetail={mockPluginDetail}
        />,
      )

      const input = screen.getByTestId('form-input')
      fireEvent.change(input, { target: { value: 'Test Name' } })

      expect(input).toHaveValue('Test Name')
    })
  })

  describe('Default Values', () => {
    it('should use defaultValues when provided', () => {
      render(
        <EndpointModal
          formSchemas={mockFormSchemas}
          defaultValues={{ name: 'Default Name' }}
          onCancel={mockOnCancel}
          onSaved={mockOnSaved}
          pluginDetail={mockPluginDetail}
        />,
      )

      expect(screen.getByTestId('form-input')).toHaveValue('Default Name')
    })

    it('should extract default values from schemas when no defaultValues', () => {
      const schemasWithDefaults = [
        { name: 'name', label: 'Name', type: 'text-input', required: true, default: 'Schema Default' },
      ] as unknown as FormSchema[]

      render(
        <EndpointModal
          formSchemas={schemasWithDefaults}
          onCancel={mockOnCancel}
          onSaved={mockOnSaved}
          pluginDetail={mockPluginDetail}
        />,
      )

      expect(screen.getByTestId('form-input')).toHaveValue('Schema Default')
    })

    it('should handle schemas without default values', () => {
      const schemasNoDefault = [
        { name: 'name', label: 'Name', type: 'text-input', required: false },
      ] as unknown as FormSchema[]

      render(
        <EndpointModal
          formSchemas={schemasNoDefault}
          onCancel={mockOnCancel}
          onSaved={mockOnSaved}
          pluginDetail={mockPluginDetail}
        />,
      )

      expect(screen.getByTestId('form')).toBeInTheDocument()
    })
  })

  describe('Validation - handleSave', () => {
    it('should show toast error when required field is empty', () => {
      const schemasWithRequired = [
        { name: 'name', label: { en_US: 'Name Field' }, type: 'text-input', required: true, default: '' },
      ] as unknown as FormSchema[]

      render(
        <EndpointModal
          formSchemas={schemasWithRequired}
          onCancel={mockOnCancel}
          onSaved={mockOnSaved}
          pluginDetail={mockPluginDetail}
        />,
      )

      fireEvent.click(screen.getByRole('button', { name: 'operation.save' }))

      expect(mockToastNotify).toHaveBeenCalledWith({
        type: 'error',
        message: expect.stringContaining('errorMsg.fieldRequired'),
      })
      expect(mockOnSaved).not.toHaveBeenCalled()
    })

    it('should show toast error with string label when required field is empty', () => {
      const schemasWithStringLabel = [
        { name: 'name', label: 'String Label', type: 'text-input', required: true, default: '' },
      ] as unknown as FormSchema[]

      render(
        <EndpointModal
          formSchemas={schemasWithStringLabel}
          onCancel={mockOnCancel}
          onSaved={mockOnSaved}
          pluginDetail={mockPluginDetail}
        />,
      )

      fireEvent.click(screen.getByRole('button', { name: 'operation.save' }))

      expect(mockToastNotify).toHaveBeenCalledWith({
        type: 'error',
        message: expect.stringContaining('String Label'),
      })
    })

    it('should call onSaved when all required fields are filled', () => {
      render(
        <EndpointModal
          formSchemas={mockFormSchemas}
          defaultValues={{ name: 'Valid Name' }}
          onCancel={mockOnCancel}
          onSaved={mockOnSaved}
          pluginDetail={mockPluginDetail}
        />,
      )

      fireEvent.click(screen.getByRole('button', { name: 'operation.save' }))

      expect(mockOnSaved).toHaveBeenCalledWith({ name: 'Valid Name' })
    })

    it('should not validate non-required empty fields', () => {
      const schemasOptional = [
        { name: 'optional', label: 'Optional', type: 'text-input', required: false, default: '' },
      ] as unknown as FormSchema[]

      render(
        <EndpointModal
          formSchemas={schemasOptional}
          onCancel={mockOnCancel}
          onSaved={mockOnSaved}
          pluginDetail={mockPluginDetail}
        />,
      )

      fireEvent.click(screen.getByRole('button', { name: 'operation.save' }))

      expect(mockToastNotify).not.toHaveBeenCalled()
      expect(mockOnSaved).toHaveBeenCalled()
    })
  })

  describe('Boolean Field Processing', () => {
    it('should convert string "true" to boolean true', () => {
      const schemasWithBoolean = [
        { name: 'enabled', label: 'Enabled', type: 'boolean', required: false, default: '' },
      ] as unknown as FormSchema[]

      render(
        <EndpointModal
          formSchemas={schemasWithBoolean}
          defaultValues={{ enabled: 'true' }}
          onCancel={mockOnCancel}
          onSaved={mockOnSaved}
          pluginDetail={mockPluginDetail}
        />,
      )

      fireEvent.click(screen.getByRole('button', { name: 'operation.save' }))

      expect(mockOnSaved).toHaveBeenCalledWith({ enabled: true })
    })

    it('should convert string "1" to boolean true', () => {
      const schemasWithBoolean = [
        { name: 'enabled', label: 'Enabled', type: 'boolean', required: false, default: '' },
      ] as unknown as FormSchema[]

      render(
        <EndpointModal
          formSchemas={schemasWithBoolean}
          defaultValues={{ enabled: '1' }}
          onCancel={mockOnCancel}
          onSaved={mockOnSaved}
          pluginDetail={mockPluginDetail}
        />,
      )

      fireEvent.click(screen.getByRole('button', { name: 'operation.save' }))

      expect(mockOnSaved).toHaveBeenCalledWith({ enabled: true })
    })

    it('should convert string "True" to boolean true', () => {
      const schemasWithBoolean = [
        { name: 'enabled', label: 'Enabled', type: 'boolean', required: false, default: '' },
      ] as unknown as FormSchema[]

      render(
        <EndpointModal
          formSchemas={schemasWithBoolean}
          defaultValues={{ enabled: 'True' }}
          onCancel={mockOnCancel}
          onSaved={mockOnSaved}
          pluginDetail={mockPluginDetail}
        />,
      )

      fireEvent.click(screen.getByRole('button', { name: 'operation.save' }))

      expect(mockOnSaved).toHaveBeenCalledWith({ enabled: true })
    })

    it('should convert string "false" to boolean false', () => {
      const schemasWithBoolean = [
        { name: 'enabled', label: 'Enabled', type: 'boolean', required: false, default: '' },
      ] as unknown as FormSchema[]

      render(
        <EndpointModal
          formSchemas={schemasWithBoolean}
          defaultValues={{ enabled: 'false' }}
          onCancel={mockOnCancel}
          onSaved={mockOnSaved}
          pluginDetail={mockPluginDetail}
        />,
      )

      fireEvent.click(screen.getByRole('button', { name: 'operation.save' }))

      expect(mockOnSaved).toHaveBeenCalledWith({ enabled: false })
    })

    it('should convert number 1 to boolean true', () => {
      const schemasWithBoolean = [
        { name: 'enabled', label: 'Enabled', type: 'boolean', required: false, default: '' },
      ] as unknown as FormSchema[]

      render(
        <EndpointModal
          formSchemas={schemasWithBoolean}
          defaultValues={{ enabled: 1 }}
          onCancel={mockOnCancel}
          onSaved={mockOnSaved}
          pluginDetail={mockPluginDetail}
        />,
      )

      fireEvent.click(screen.getByRole('button', { name: 'operation.save' }))

      expect(mockOnSaved).toHaveBeenCalledWith({ enabled: true })
    })

    it('should convert number 0 to boolean false', () => {
      const schemasWithBoolean = [
        { name: 'enabled', label: 'Enabled', type: 'boolean', required: false, default: '' },
      ] as unknown as FormSchema[]

      render(
        <EndpointModal
          formSchemas={schemasWithBoolean}
          defaultValues={{ enabled: 0 }}
          onCancel={mockOnCancel}
          onSaved={mockOnSaved}
          pluginDetail={mockPluginDetail}
        />,
      )

      fireEvent.click(screen.getByRole('button', { name: 'operation.save' }))

      expect(mockOnSaved).toHaveBeenCalledWith({ enabled: false })
    })

    it('should preserve boolean true value', () => {
      const schemasWithBoolean = [
        { name: 'enabled', label: 'Enabled', type: 'boolean', required: false, default: '' },
      ] as unknown as FormSchema[]

      render(
        <EndpointModal
          formSchemas={schemasWithBoolean}
          defaultValues={{ enabled: true }}
          onCancel={mockOnCancel}
          onSaved={mockOnSaved}
          pluginDetail={mockPluginDetail}
        />,
      )

      fireEvent.click(screen.getByRole('button', { name: 'operation.save' }))

      expect(mockOnSaved).toHaveBeenCalledWith({ enabled: true })
    })

    it('should preserve boolean false value', () => {
      const schemasWithBoolean = [
        { name: 'enabled', label: 'Enabled', type: 'boolean', required: false, default: '' },
      ] as unknown as FormSchema[]

      render(
        <EndpointModal
          formSchemas={schemasWithBoolean}
          defaultValues={{ enabled: false }}
          onCancel={mockOnCancel}
          onSaved={mockOnSaved}
          pluginDetail={mockPluginDetail}
        />,
      )

      fireEvent.click(screen.getByRole('button', { name: 'operation.save' }))

      expect(mockOnSaved).toHaveBeenCalledWith({ enabled: false })
    })

    it('should not process non-boolean fields', () => {
      const schemasWithText = [
        { name: 'text', label: 'Text', type: 'text-input', required: false, default: '' },
      ] as unknown as FormSchema[]

      render(
        <EndpointModal
          formSchemas={schemasWithText}
          defaultValues={{ text: 'hello' }}
          onCancel={mockOnCancel}
          onSaved={mockOnSaved}
          pluginDetail={mockPluginDetail}
        />,
      )

      fireEvent.click(screen.getByRole('button', { name: 'operation.save' }))

      expect(mockOnSaved).toHaveBeenCalledWith({ text: 'hello' })
    })
  })

  describe('Memoization', () => {
    it('should be wrapped with React.memo', () => {
      expect(EndpointModal).toBeDefined()
      expect((EndpointModal as { $$typeof?: symbol }).$$typeof).toBeDefined()
    })
  })
})
