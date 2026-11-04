import type { TriggerEvent } from '@/app/components/plugins/types'
import type { TriggerProviderApiEntity } from '@/app/components/workflow/block-selector/types'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { EventDetailDrawer } from '../event-detail-drawer'

vi.mock('@/app/components/header/account-setting/model-provider-page/hooks', () => ({
  useLanguage: () => 'en_US',
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
  const onClose = vi.fn()
  const renderEvent = (eventInfo = mockEventInfo) =>
    render(
      <EventDetailDrawer eventInfo={eventInfo} providerInfo={mockProviderInfo} onClose={onClose} />,
    )

  beforeEach(() => vi.clearAllMocks())

  it('shows the event identity, provider, required parameters and output fields', () => {
    renderEvent()
    const drawer = within(screen.getByRole('dialog'))
    expect(drawer.getByText('Test Event')).toBeInTheDocument()
    expect(drawer.getByText('Test event description')).toBeInTheDocument()
    expect(drawer.getByText('test-author')).toBeInTheDocument()
    expect(drawer.getByText('test-name')).toBeInTheDocument()
    expect(drawer.getByText('Parameter 1')).toBeInTheDocument()
    expect(drawer.getByText('A test parameter')).toBeInTheDocument()
    expect(drawer.getByText('tools.setBuiltInTools.string')).toBeInTheDocument()
    expect(drawer.getByText('tools.setBuiltInTools.required')).toBeInTheDocument()
    expect(drawer.getByText('result')).toBeInTheDocument()
    expect(drawer.getByText('Result')).toBeInTheDocument()
    expect(drawer.getByText('app.structOutput.required')).toBeInTheDocument()
  })

  it.each(['common.operation.close', 'plugin.detailPanel.operation.back'])(
    'closes through %s',
    async (name) => {
      const user = userEvent.setup()
      renderEvent()
      await user.click(screen.getByRole('button', { name }))
      expect(onClose).toHaveBeenCalledOnce()
    },
  )

  it('shows an empty parameter state and no stale output fields', () => {
    renderEvent({ ...mockEventInfo, parameters: [], output_schema: {} })
    expect(screen.getByText('pluginTrigger.events.item.noParameters')).toBeInTheDocument()
    expect(screen.getByText('pluginTrigger.events.output')).toBeInTheDocument()
    expect(screen.queryByText('Parameter 1')).not.toBeInTheDocument()
    expect(screen.queryByText('result')).not.toBeInTheDocument()
  })

  it.each([
    ['number-input', 'tools.setBuiltInTools.number'],
    ['checkbox', 'boolean'],
    ['file', 'tools.setBuiltInTools.file'],
  ])('labels a %s parameter as %s', (type, label) => {
    renderEvent({ ...mockEventInfo, parameters: [{ ...mockEventInfo.parameters[0]!, type }] })
    expect(screen.getByText(label)).toBeInTheDocument()
  })

  it('renders converted nested, array, enum and nullable output schemas', () => {
    renderEvent({
      ...mockEventInfo,
      output_schema: {
        properties: {
          records: { type: 'array', items: { type: 'string' }, description: 'Collected values' },
          nested: {
            type: 'object',
            properties: { inner: { type: 'number', description: 'Nested value' } },
            required: ['inner'],
          },
          status: { type: 'string', enum: ['active', 'inactive'] },
          nullable: { type: ['string', 'null'], description: 'Optional value' },
        },
        required: ['nested'],
      },
    })
    expect(screen.getByText('records')).toBeInTheDocument()
    expect(screen.getByText('array[string]')).toBeInTheDocument()
    expect(screen.getByText('Collected values')).toBeInTheDocument()
    expect(screen.getByText('inner')).toBeInTheDocument()
    expect(screen.getByText('number')).toBeInTheDocument()
    expect(screen.getByText('Nested value')).toBeInTheDocument()
    expect(screen.getAllByText('app.structOutput.required')).toHaveLength(2)
    expect(screen.getByText(/"active"/)).toBeInTheDocument()
    expect(screen.getByText('"inactive"')).toBeInTheDocument()
    expect(screen.getByText('nullable')).toBeInTheDocument()
    expect(screen.getByText('string')).toBeInTheDocument()
    expect(screen.getByText('Optional value')).toBeInTheDocument()
  })
})
