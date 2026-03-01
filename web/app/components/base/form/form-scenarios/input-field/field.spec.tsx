import type { InputFieldConfiguration } from './types'
import { render, screen } from '@testing-library/react'
import { useMemo } from 'react'
import { useAppForm } from '../..'
import InputField from './field'
import { InputFieldType } from './types'

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
  const Component = useMemo(() => InputField({ initialData, config }), [config, initialData])

  return <Component form={form} />
}

describe('InputField', () => {
  it('should render text input field by default', () => {
    render(<FieldHarness config={createConfig({ label: 'Prompt' })} initialData={{ fieldA: '' }} />)

    expect(screen.getByRole('textbox')).toBeInTheDocument()
    expect(screen.getByText('Prompt')).toBeInTheDocument()
  })

  it('should render number slider field when configured', () => {
    render(
      <FieldHarness
        config={createConfig({
          type: InputFieldType.numberSlider,
          label: 'Temperature',
          description: 'Control randomness',
          min: 0,
          max: 1,
        })}
        initialData={{ fieldA: 0.5 }}
      />,
    )

    expect(screen.getByText('Temperature')).toBeInTheDocument()
    expect(screen.getByText('Control randomness')).toBeInTheDocument()
  })

  it('should render select field with options when configured', () => {
    render(
      <FieldHarness
        config={createConfig({
          type: InputFieldType.select,
          label: 'Mode',
          options: [{ value: 'safe', label: 'Safe' }],
        })}
        initialData={{ fieldA: 'safe' }}
      />,
    )

    expect(screen.getByText('Mode')).toBeInTheDocument()
  })

  it('should render upload method field when configured', () => {
    render(
      <FieldHarness
        config={createConfig({
          type: InputFieldType.uploadMethod,
          label: 'Upload Method',
        })}
        initialData={{ fieldA: 'local_file' }}
      />,
    )

    expect(screen.getByText('Upload Method')).toBeInTheDocument()
  })

  it('should hide the field when show conditions are not met', () => {
    render(
      <FieldHarness
        config={createConfig({
          label: 'Hidden Input',
          showConditions: [{ variable: 'enabled', value: true }],
        })}
        initialData={{ enabled: false, fieldA: '' }}
      />,
    )

    expect(screen.queryByText('Hidden Input')).not.toBeInTheDocument()
  })

  it('should render remaining field types and fallback for unsupported type', () => {
    const scenarios: Array<{ config: InputFieldConfiguration, initialData: Record<string, unknown> }> = [
      {
        config: createConfig({ type: InputFieldType.numberInput, label: 'Count', min: 1, max: 5 }),
        initialData: { fieldA: 2 },
      },
      {
        config: createConfig({ type: InputFieldType.checkbox, label: 'Enable' }),
        initialData: { fieldA: false },
      },
      {
        config: createConfig({ type: InputFieldType.inputTypeSelect, label: 'Input Type', supportFile: true }),
        initialData: { fieldA: 'text' },
      },
      {
        config: createConfig({ type: InputFieldType.fileTypes, label: 'File Types' }),
        initialData: { fieldA: { allowedFileTypes: ['document'] } },
      },
      {
        config: createConfig({ type: InputFieldType.options, label: 'Choices' }),
        initialData: { fieldA: ['one'] },
      },
    ]

    for (const scenario of scenarios) {
      const { unmount } = render(<FieldHarness config={scenario.config} initialData={scenario.initialData} />)
      expect(screen.getByText(scenario.config.label)).toBeInTheDocument()
      unmount()
    }

    render(
      <FieldHarness
        config={createConfig({ type: 'unsupported' as InputFieldType, label: 'Unsupported' })}
        initialData={{ fieldA: '' }}
      />,
    )
    expect(screen.queryByText('Unsupported')).not.toBeInTheDocument()
  })
})
