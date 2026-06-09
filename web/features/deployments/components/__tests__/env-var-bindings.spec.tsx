import type { EnvVarBindingSlot, EnvVarValues } from '../env-var-bindings'
import { EnvVarValueSource } from '@dify/contracts/enterprise/types.gen'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { EnvVarBindingsPanel } from '../env-var-bindings'

function createEnvVarSlot(overrides: Partial<EnvVarBindingSlot> = {}): EnvVarBindingSlot {
  return {
    key: 'API_KEY',
    valueType: 'string',
    ...overrides,
  }
}

function renderEnvVarBindingsPanel({
  defaultSourcePriority,
  slot,
  values = {},
}: {
  defaultSourcePriority?: 'dslDefault' | 'lastDeployment'
  slot: EnvVarBindingSlot
  values?: EnvVarValues
}) {
  return render(
    <EnvVarBindingsPanel
      slots={[slot]}
      values={values}
      title="Environment Variables"
      hint="Choose values."
      envVarPlaceholder="Enter value"
      literalSourceLabel="Custom value"
      defaultSourceLabel="App value"
      lastDeploymentSourceLabel="Last deployed value"
      valueTypeLabels={{
        number: 'Number',
        secret: 'Secret',
        string: 'String',
      }}
      sourceAriaLabel={key => `Select source for ${key}`}
      defaultSourcePriority={defaultSourcePriority}
      onChange={vi.fn()}
    />,
  )
}

// The panel resolves display values directly from slot metadata when the form state is empty.
describe('EnvVarBindingsPanel', () => {
  it('should show the app default value by default when both sources exist', () => {
    renderEnvVarBindingsPanel({
      slot: createEnvVarSlot({
        hasDefaultValue: true,
        defaultValue: 'app-value',
        hasLastValue: true,
        lastValue: 'last-value',
      }),
    })

    expect(screen.getByDisplayValue('app-value')).toBeDisabled()
    expect(screen.getByText('App value')).toBeInTheDocument()
    expect(screen.getByText('Last deployed value')).toBeInTheDocument()
  })

  it('should show the last deployed value when that source is prioritized', () => {
    renderEnvVarBindingsPanel({
      defaultSourcePriority: 'lastDeployment',
      slot: createEnvVarSlot({
        hasDefaultValue: true,
        defaultValue: 'app-value',
        hasLastValue: true,
        lastValue: 'last-value',
      }),
    })

    expect(screen.getByDisplayValue('last-value')).toBeDisabled()
  })

  it('should show an existing manual value when the user changed the field', () => {
    renderEnvVarBindingsPanel({
      slot: createEnvVarSlot({
        hasDefaultValue: true,
        defaultValue: 'app-value',
      }),
      values: {
        API_KEY: {
          value: 'manual-value',
          valueSource: EnvVarValueSource.ENV_VAR_VALUE_SOURCE_LITERAL,
        },
      },
    })

    expect(screen.getByDisplayValue('manual-value')).toBeEnabled()
  })
})
