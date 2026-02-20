import type { ReactNode } from 'react'
import type { InputFieldConfiguration } from './types'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { useMemo } from 'react'
import { ReactFlowProvider } from 'reactflow'
import { useAppForm } from '../..'
import NodePanelField from './field'
import { InputFieldType } from './types'

vi.mock('@/app/components/workflow/nodes/_base/components/variable/var-reference-picker', () => ({
  default: () => <div>Variable Picker</div>,
}))

const createConfig = (overrides: Partial<InputFieldConfiguration> = {}): InputFieldConfiguration => ({
  type: InputFieldType.textInput,
  variable: 'fieldA',
  label: 'Field A',
  required: false,
  showConditions: [],
  ...overrides,
})

type FieldHarnessProps = {
  config: InputFieldConfiguration
  initialData?: Record<string, unknown>
}

const FieldHarness = ({ config, initialData = {} }: FieldHarnessProps) => {
  const form = useAppForm({
    defaultValues: initialData,
    onSubmit: () => {},
  })
  const Component = useMemo(() => NodePanelField({ initialData, config }), [config, initialData])

  return <Component form={form} />
}

const NodePanelWrapper = ({ children }: { children: ReactNode }) => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })

  return (
    <QueryClientProvider client={queryClient}>
      <ReactFlowProvider>
        {children}
      </ReactFlowProvider>
    </QueryClientProvider>
  )
}

describe('NodePanelField', () => {
  it('should render text input field', () => {
    render(<FieldHarness config={createConfig({ label: 'Node Name' })} initialData={{ fieldA: '' }} />)

    expect(screen.getByRole('textbox')).toBeInTheDocument()
    expect(screen.getByText('Node Name')).toBeInTheDocument()
  })

  it('should render variable-or-constant field when configured', () => {
    render(
      <NodePanelWrapper>
        <FieldHarness
          config={createConfig({
            type: InputFieldType.variableOrConstant,
            label: 'Mode',
          })}
          initialData={{ fieldA: '' }}
        />
      </NodePanelWrapper>,
    )

    expect(screen.getByText('Mode')).toBeInTheDocument()
  })

  it('should hide field when show conditions are not satisfied', () => {
    render(
      <FieldHarness
        config={createConfig({
          label: 'Hidden Node Field',
          showConditions: [{ variable: 'enabled', value: true }],
        })}
        initialData={{ enabled: false, fieldA: '' }}
      />,
    )

    expect(screen.queryByText('Hidden Node Field')).not.toBeInTheDocument()
  })

  it('should render other configured field types and hide unsupported type', () => {
    const scenarios: Array<{ config: InputFieldConfiguration, initialData: Record<string, unknown> }> = [
      {
        config: createConfig({ type: InputFieldType.numberInput, label: 'Count', min: 1, max: 3 }),
        initialData: { fieldA: 2 },
      },
      {
        config: createConfig({ type: InputFieldType.numberSlider, label: 'Temperature', description: 'Adjust' }),
        initialData: { fieldA: 0.4 },
      },
      {
        config: createConfig({ type: InputFieldType.checkbox, label: 'Enabled' }),
        initialData: { fieldA: true },
      },
      {
        config: createConfig({ type: InputFieldType.select, label: 'Mode', options: [{ value: 'safe', label: 'Safe' }] }),
        initialData: { fieldA: 'safe' },
      },
      {
        config: createConfig({ type: InputFieldType.inputTypeSelect, label: 'Input Type', supportFile: true }),
        initialData: { fieldA: 'text' },
      },
      {
        config: createConfig({ type: InputFieldType.uploadMethod, label: 'Upload Method' }),
        initialData: { fieldA: ['local_file'] },
      },
      {
        config: createConfig({ type: InputFieldType.fileTypes, label: 'File Types' }),
        initialData: { fieldA: { allowedFileTypes: ['document'] } },
      },
      {
        config: createConfig({ type: InputFieldType.options, label: 'Options' }),
        initialData: { fieldA: ['a'] },
      },
    ]

    for (const scenario of scenarios) {
      const { unmount } = render(<FieldHarness config={scenario.config} initialData={scenario.initialData} />)
      expect(screen.getByText(scenario.config.label)).toBeInTheDocument()
      unmount()
    }

    render(
      <FieldHarness
        config={createConfig({ type: 'unsupported' as InputFieldType, label: 'Unsupported Node' })}
        initialData={{ fieldA: '' }}
      />,
    )
    expect(screen.queryByText('Unsupported Node')).not.toBeInTheDocument()
  })
})
