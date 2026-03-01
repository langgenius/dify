import type { BaseConfiguration } from './types'
import { render, screen } from '@testing-library/react'
import { useMemo } from 'react'
import { TransferMethod } from '@/types/app'
import { useAppForm } from '../..'
import BaseField from './field'
import { BaseFieldType } from './types'

vi.mock('next/navigation', () => ({
  useParams: () => ({}),
}))

const createConfig = (overrides: Partial<BaseConfiguration> = {}): BaseConfiguration => ({
  type: BaseFieldType.textInput,
  variable: 'fieldA',
  label: 'Field A',
  required: false,
  showConditions: [],
  ...overrides,
})

type FieldHarnessProps = {
  config: BaseConfiguration
  initialData?: Record<string, unknown>
}

const FieldHarness = ({ config, initialData = {} }: FieldHarnessProps) => {
  const form = useAppForm({
    defaultValues: initialData,
    onSubmit: () => {},
  })
  const Component = useMemo(() => BaseField({ initialData, config }), [config, initialData])

  return <Component form={form} />
}

describe('BaseField', () => {
  it('should render a text input field when configured as text input', () => {
    render(<FieldHarness config={createConfig({ label: 'Username' })} initialData={{ fieldA: '' }} />)

    expect(screen.getByRole('textbox')).toBeInTheDocument()
    expect(screen.getByText('Username')).toBeInTheDocument()
  })

  it('should render a number input when configured as number input', () => {
    render(<FieldHarness config={createConfig({ type: BaseFieldType.numberInput, label: 'Age' })} initialData={{ fieldA: 20 }} />)

    expect(screen.getByRole('spinbutton')).toBeInTheDocument()
    expect(screen.getByText('Age')).toBeInTheDocument()
  })

  it('should render a checkbox when configured as checkbox', () => {
    render(<FieldHarness config={createConfig({ type: BaseFieldType.checkbox, label: 'Agree' })} initialData={{ fieldA: false }} />)

    expect(screen.getByText('Agree')).toBeInTheDocument()
  })

  it('should render paragraph and select fields based on configuration', () => {
    const scenarios: Array<{ config: BaseConfiguration, initialData: Record<string, unknown> }> = [
      {
        config: createConfig({
          type: BaseFieldType.paragraph,
          label: 'Description',
        }),
        initialData: { fieldA: 'hello' },
      },
      {
        config: createConfig({
          type: BaseFieldType.select,
          label: 'Mode',
          options: [{ value: 'safe', label: 'Safe' }],
        }),
        initialData: { fieldA: 'safe' },
      },
    ]

    for (const scenario of scenarios) {
      const { unmount } = render(<FieldHarness config={scenario.config} initialData={scenario.initialData} />)
      expect(screen.getByText(scenario.config.label)).toBeInTheDocument()
      unmount()
    }
  })

  it('should render file uploader when configured as file', () => {
    const scenarios: Array<{ config: BaseConfiguration, initialData: Record<string, unknown> }> = [
      {
        config: createConfig({
          type: BaseFieldType.file,
          label: 'Attachment',
          allowedFileExtensions: ['txt'],
          allowedFileTypes: ['document'],
          allowedFileUploadMethods: [TransferMethod.local_file],
        }),
        initialData: { fieldA: [] },
      },
      {
        config: createConfig({
          type: BaseFieldType.fileList,
          label: 'Attachments',
          maxLength: 2,
          allowedFileExtensions: ['txt'],
          allowedFileTypes: ['document'],
          allowedFileUploadMethods: [TransferMethod.local_file],
        }),
        initialData: { fieldA: [] },
      },
    ]

    for (const scenario of scenarios) {
      const { unmount } = render(<FieldHarness config={scenario.config} initialData={scenario.initialData} />)
      expect(screen.getByText(scenario.config.label)).toBeInTheDocument()
      unmount()
    }

    render(
      <FieldHarness
        config={createConfig({ type: 'unsupported' as BaseFieldType, label: 'Unsupported' })}
        initialData={{ fieldA: '' }}
      />,
    )
    expect(screen.queryByText('Unsupported')).not.toBeInTheDocument()
  })

  it('should not render when show conditions are not met', () => {
    render(
      <FieldHarness
        config={createConfig({
          label: 'Hidden Field',
          showConditions: [{ variable: 'toggle', value: true }],
        })}
        initialData={{ fieldA: '', toggle: false }}
      />,
    )

    expect(screen.queryByText('Hidden Field')).not.toBeInTheDocument()
  })
})
