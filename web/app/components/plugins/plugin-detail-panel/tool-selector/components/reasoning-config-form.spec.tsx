import type { ReasoningConfigValue } from '../utils/show-on'
import type { ToolFormSchema } from '@/app/components/tools/utils/to-form-schema'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { FormTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { VarType as VarKindType } from '@/app/components/workflow/nodes/tool/types'
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

    const hiddenValue: ReasoningConfigValue = {
      mode: { auto: 0, value: { type: VarKindType.constant, value: false } },
      extra: { auto: 0, value: { type: VarKindType.constant, value: 'should-hide' } },
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
          extra: hiddenValue.extra,
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
