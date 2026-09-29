import type { ReasoningConfigValue } from '../utils/show-on'
import type { ToolFormSchema } from '@/app/components/tools/utils/to-form-schema'
import { screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { FormTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { VarKindType } from '@/app/components/workflow/nodes/_base/types'
import { renderWithAccountProfile as render } from '@/test/console/account-profile'
import ReasoningConfigForm from './reasoning-config-form'

function reasoningSchema(overrides: Partial<ToolFormSchema>): ToolFormSchema {
  return {
    name: overrides.variable ?? 'field',
    variable: 'field',
    label: { en_US: 'Label', zh_Hans: 'Label' },
    human_description: { en_US: '', zh_Hans: '' },
    type: FormTypeEnum.checkbox,
    _type: 'boolean',
    form: 'llm',
    required: false,
    llm_description: '',
    multiple: false,
    default: 'false',
    show_on: [],
    ...overrides,
  } as ToolFormSchema
}

describe('ReasoningConfigForm show_on visibility', () => {
  it('should clear hidden manual values while preserving automatic values', () => {
    const schemas = [
      reasoningSchema({
        variable: 'mode',
        label: { en_US: 'MODE_ROW', zh_Hans: 'MODE_ROW' },
        default: 'false',
      }),
      reasoningSchema({
        variable: 'prompt',
        label: { en_US: 'PROMPT_ROW', zh_Hans: 'PROMPT_ROW' },
        default: 'false',
        show_on: [{ variable: 'mode', value: 'true' }],
      }),
      reasoningSchema({
        variable: 'automatic',
        label: { en_US: 'AUTO_ROW', zh_Hans: 'AUTO_ROW' },
        show_on: [{ variable: 'mode', value: 'true' }],
      }),
    ]
    const onChange = vi.fn()
    const visibleValue: ReasoningConfigValue = {
      mode: { auto: 0, value: { type: VarKindType.constant, value: true } },
      prompt: { auto: 0, value: { type: VarKindType.constant, value: true } },
      automatic: { auto: 1, value: null },
    }
    const props = { onChange, schemas, nodeOutputVars: [], availableNodes: [], nodeId: 'node-1' }
    const { rerender } = render(<ReasoningConfigForm {...props} value={visibleValue} />)

    expect(screen.getByText('PROMPT_ROW')).toBeInTheDocument()
    expect(screen.getByText('AUTO_ROW')).toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()

    rerender(
      <ReasoningConfigForm
        {...props}
        value={{
          ...visibleValue,
          mode: { auto: 0, value: { type: VarKindType.constant, value: false } },
        }}
      />,
    )

    expect(screen.queryByText('PROMPT_ROW')).toBeNull()
    expect(screen.queryByText('AUTO_ROW')).toBeNull()
    expect(onChange).toHaveBeenCalledExactlyOnceWith({
      mode: { auto: 0, value: { type: VarKindType.constant, value: false } },
      prompt: { auto: 0, value: { type: VarKindType.constant, value: false } },
      automatic: { auto: 1, value: null },
    })
  })

  it('should omit dependent parameter rows until sibling conditions match', () => {
    const modeSchema = reasoningSchema({
      variable: 'mode',
      name: 'mode',
      label: { en_US: 'MODE_ROW', zh_Hans: 'MODE_ROW' },
      default: 'false',
    })
    const extraSchema = reasoningSchema({
      variable: 'extra',
      name: 'extra',
      label: { en_US: 'EXTRA_ROW', zh_Hans: 'EXTRA_ROW' },
      default: 'fallback',
      show_on: [{ variable: 'mode', value: 'true' }],
    })

    const extraValue: ReasoningConfigValue[string] = {
      auto: 0,
      value: { type: VarKindType.constant, value: 'should-hide' },
    }
    const hiddenValue: ReasoningConfigValue = {
      mode: { auto: 0, value: { type: VarKindType.constant, value: false } },
      extra: extraValue,
    }

    const { rerender } = render(
      <ReasoningConfigForm
        value={hiddenValue}
        onChange={vi.fn()}
        schemas={[modeSchema, extraSchema]}
        nodeOutputVars={[]}
        availableNodes={[]}
        nodeId="node-1"
      />,
    )

    expect(screen.queryByText('EXTRA_ROW')).toBeNull()

    rerender(
      <ReasoningConfigForm
        value={{
          mode: { auto: 0, value: { type: VarKindType.constant, value: true } },
          extra: extraValue,
        }}
        onChange={vi.fn()}
        schemas={[modeSchema, extraSchema]}
        nodeOutputVars={[]}
        availableNodes={[]}
        nodeId="node-1"
      />,
    )

    expect(screen.getByText('EXTRA_ROW')).toBeInTheDocument()
  })
})
