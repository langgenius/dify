import type { TriggerEvent } from '@/app/components/plugins/types'
import type { TriggerProviderApiEntity } from '@/app/components/workflow/block-selector/types'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EventDetailDrawer } from './event-detail-drawer'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('@/app/components/header/account-setting/model-provider-page/hooks', () => ({
  useLanguage: () => 'en_US',
}))

vi.mock('@/utils/classnames', () => ({
  cn: (...args: (string | undefined | false | null)[]) => args.filter(Boolean).join(' '),
}))

vi.mock('@/app/components/plugins/card/base/card-icon', () => ({
  default: () => <span data-testid="card-icon" />,
}))

vi.mock('@/app/components/plugins/card/base/description', () => ({
  default: ({ text }: { text: string }) => <div data-testid="description">{text}</div>,
}))

vi.mock('@/app/components/plugins/card/base/org-info', () => ({
  default: ({ orgName }: { orgName: string }) => <div data-testid="org-info">{orgName}</div>,
}))

vi.mock('@/app/components/tools/utils/to-form-schema', () => ({
  triggerEventParametersToFormSchemas: (params: Array<Record<string, unknown>>) =>
    params.map(p => ({
      label: (p.label as Record<string, string>) || { en_US: p.name as string },
      type: (p.type as string) || 'text-input',
      required: (p.required as boolean) || false,
      description: p.description as Record<string, string> | undefined,
    })),
}))

vi.mock('@/app/components/workflow/nodes/_base/components/variable/object-child-tree-panel/show/field', () => ({
  default: ({ name }: { name: string }) => <div data-testid="output-field">{name}</div>,
}))

const mockEventInfo = {
  name: 'test-event',
  identity: {
    author: 'test-author',
    name: 'test-event',
    label: { en_US: 'Test Event' },
  },
  description: { en_US: 'Test event description' },
  parameters: [
    {
      name: 'param1',
      label: { en_US: 'Parameter 1' },
      type: 'text-input',
      auto_generate: null,
      template: null,
      scope: null,
      required: true,
      multiple: false,
      default: null,
      min: null,
      max: null,
      precision: null,
      description: { en_US: 'A test parameter' },
    },
  ],
  output_schema: {
    properties: {
      result: { type: 'string', description: 'Result' },
    },
    required: ['result'],
  },
} as unknown as TriggerEvent

const mockProviderInfo = {
  provider: 'test-provider',
  author: 'test-author',
  name: 'test-provider/test-name',
  icon: 'icon.png',
  description: { en_US: 'Provider desc' },
  supported_creation_methods: [],
} as unknown as TriggerProviderApiEntity

describe('EventDetailDrawer', () => {
  const mockOnClose = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render drawer', () => {
      render(<EventDetailDrawer eventInfo={mockEventInfo} providerInfo={mockProviderInfo} onClose={mockOnClose} />)

      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    it('should render event title', () => {
      render(<EventDetailDrawer eventInfo={mockEventInfo} providerInfo={mockProviderInfo} onClose={mockOnClose} />)

      expect(screen.getByText('Test Event')).toBeInTheDocument()
    })

    it('should render event description', () => {
      render(<EventDetailDrawer eventInfo={mockEventInfo} providerInfo={mockProviderInfo} onClose={mockOnClose} />)

      expect(screen.getByTestId('description')).toHaveTextContent('Test event description')
    })

    it('should render org info', () => {
      render(<EventDetailDrawer eventInfo={mockEventInfo} providerInfo={mockProviderInfo} onClose={mockOnClose} />)

      expect(screen.getByTestId('org-info')).toBeInTheDocument()
    })

    it('should render parameters section', () => {
      render(<EventDetailDrawer eventInfo={mockEventInfo} providerInfo={mockProviderInfo} onClose={mockOnClose} />)

      expect(screen.getByText('setBuiltInTools.parameters')).toBeInTheDocument()
      expect(screen.getByText('Parameter 1')).toBeInTheDocument()
    })

    it('should render output section', () => {
      render(<EventDetailDrawer eventInfo={mockEventInfo} providerInfo={mockProviderInfo} onClose={mockOnClose} />)

      expect(screen.getByText('events.output')).toBeInTheDocument()
      expect(screen.getByTestId('output-field')).toHaveTextContent('result')
    })

    it('should render back button', () => {
      render(<EventDetailDrawer eventInfo={mockEventInfo} providerInfo={mockProviderInfo} onClose={mockOnClose} />)

      expect(screen.getByText('detailPanel.operation.back')).toBeInTheDocument()
    })
  })

  describe('User Interactions', () => {
    it('should call onClose when close button clicked', () => {
      render(<EventDetailDrawer eventInfo={mockEventInfo} providerInfo={mockProviderInfo} onClose={mockOnClose} />)

      // Find the close button (ActionButton with action-btn class)
      const closeButton = screen.getAllByRole('button').find(btn => btn.classList.contains('action-btn'))
      if (closeButton)
        fireEvent.click(closeButton)

      expect(mockOnClose).toHaveBeenCalledTimes(1)
    })

    it('should call onClose when back clicked', () => {
      render(<EventDetailDrawer eventInfo={mockEventInfo} providerInfo={mockProviderInfo} onClose={mockOnClose} />)

      fireEvent.click(screen.getByText('detailPanel.operation.back'))

      expect(mockOnClose).toHaveBeenCalledTimes(1)
    })
  })

  describe('Edge Cases', () => {
    it('should handle no parameters', () => {
      const eventWithNoParams = { ...mockEventInfo, parameters: [] }
      render(<EventDetailDrawer eventInfo={eventWithNoParams} providerInfo={mockProviderInfo} onClose={mockOnClose} />)

      expect(screen.getByText('events.item.noParameters')).toBeInTheDocument()
    })

    it('should handle no output schema', () => {
      const eventWithNoOutput = { ...mockEventInfo, output_schema: {} }
      render(<EventDetailDrawer eventInfo={eventWithNoOutput} providerInfo={mockProviderInfo} onClose={mockOnClose} />)

      expect(screen.getByText('events.output')).toBeInTheDocument()
      expect(screen.queryByTestId('output-field')).not.toBeInTheDocument()
    })
  })

  describe('Parameter Types', () => {
    it('should display correct type for number-input', () => {
      const eventWithNumber = {
        ...mockEventInfo,
        parameters: [{ ...mockEventInfo.parameters[0], type: 'number-input' }],
      }
      render(<EventDetailDrawer eventInfo={eventWithNumber} providerInfo={mockProviderInfo} onClose={mockOnClose} />)

      expect(screen.getByText('setBuiltInTools.number')).toBeInTheDocument()
    })

    it('should display correct type for checkbox', () => {
      const eventWithCheckbox = {
        ...mockEventInfo,
        parameters: [{ ...mockEventInfo.parameters[0], type: 'checkbox' }],
      }
      render(<EventDetailDrawer eventInfo={eventWithCheckbox} providerInfo={mockProviderInfo} onClose={mockOnClose} />)

      expect(screen.getByText('boolean')).toBeInTheDocument()
    })

    it('should display correct type for file', () => {
      const eventWithFile = {
        ...mockEventInfo,
        parameters: [{ ...mockEventInfo.parameters[0], type: 'file' }],
      }
      render(<EventDetailDrawer eventInfo={eventWithFile} providerInfo={mockProviderInfo} onClose={mockOnClose} />)

      expect(screen.getByText('setBuiltInTools.file')).toBeInTheDocument()
    })

    it('should display original type for unknown types', () => {
      const eventWithUnknown = {
        ...mockEventInfo,
        parameters: [{ ...mockEventInfo.parameters[0], type: 'custom-type' }],
      }
      render(<EventDetailDrawer eventInfo={eventWithUnknown} providerInfo={mockProviderInfo} onClose={mockOnClose} />)

      expect(screen.getByText('custom-type')).toBeInTheDocument()
    })
  })

  describe('Output Schema Conversion', () => {
    it('should handle array type in output schema', () => {
      const eventWithArrayOutput = {
        ...mockEventInfo,
        output_schema: {
          properties: {
            items: { type: 'array', items: { type: 'string' }, description: 'Array items' },
          },
          required: [],
        },
      }
      render(<EventDetailDrawer eventInfo={eventWithArrayOutput} providerInfo={mockProviderInfo} onClose={mockOnClose} />)

      expect(screen.getByText('events.output')).toBeInTheDocument()
    })

    it('should handle nested properties in output schema', () => {
      const eventWithNestedOutput = {
        ...mockEventInfo,
        output_schema: {
          properties: {
            nested: {
              type: 'object',
              properties: { inner: { type: 'string' } },
              required: ['inner'],
            },
          },
          required: [],
        },
      }
      render(<EventDetailDrawer eventInfo={eventWithNestedOutput} providerInfo={mockProviderInfo} onClose={mockOnClose} />)

      expect(screen.getByText('events.output')).toBeInTheDocument()
    })

    it('should handle enum in output schema', () => {
      const eventWithEnumOutput = {
        ...mockEventInfo,
        output_schema: {
          properties: {
            status: { type: 'string', enum: ['active', 'inactive'], description: 'Status' },
          },
          required: [],
        },
      }
      render(<EventDetailDrawer eventInfo={eventWithEnumOutput} providerInfo={mockProviderInfo} onClose={mockOnClose} />)

      expect(screen.getByText('events.output')).toBeInTheDocument()
    })

    it('should handle array type schema', () => {
      const eventWithArrayType = {
        ...mockEventInfo,
        output_schema: {
          properties: {
            multi: { type: ['string', 'null'], description: 'Multi type' },
          },
          required: [],
        },
      }
      render(<EventDetailDrawer eventInfo={eventWithArrayType} providerInfo={mockProviderInfo} onClose={mockOnClose} />)

      expect(screen.getByText('events.output')).toBeInTheDocument()
    })
  })
})
