import type { CredentialFormSchema } from '@/app/components/header/account-setting/model-provider-page/declarations'
import type { ToolVarInputs } from '@/app/components/workflow/nodes/tool/types'
import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { FormTypeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { VarKindType } from '@/app/components/workflow/nodes/_base/types'
import ToolForm from './index'

vi.mock('./item', () => ({
  default: ({ schema }: { schema: { variable: string } }) => (
    <div data-testid={`tool-field-${schema.variable}`}>{schema.variable}</div>
  ),
}))

const textSchema = (overrides: Partial<CredentialFormSchema>): CredentialFormSchema => ({
  name: 'x',
  variable: 'x',
  label: { en_US: 'L', zh_Hans: 'L' },
  type: FormTypeEnum.textInput,
  required: false,
  show_on: [],
  ...overrides,
} as CredentialFormSchema)

describe('ToolForm show_on visibility', () => {
  it('should hide dependent fields when sibling conditions are not met', () => {
    const schema: CredentialFormSchema[] = [
      textSchema({ name: 'mode', variable: 'mode', default: 'free' }),
      textSchema({
        name: 'extra',
        variable: 'extra',
        show_on: [{ variable: 'mode', value: 'pro' }],
        default: 'default-extra',
      }),
    ]
    const value: ToolVarInputs = {
      mode: { type: VarKindType.constant, value: 'free' },
      extra: { type: VarKindType.constant, value: 'user-filled' },
    }

    render(
      <ToolForm
        readOnly={false}
        nodeId="n1"
        schema={schema}
        value={value}
        onChange={vi.fn()}
      />,
    )

    expect(document.querySelector('[data-testid="tool-field-extra"]')).toBeNull()
    expect(document.querySelector('[data-testid="tool-field-mode"]')).not.toBeNull()
  })

  it('should render dependent fields when sibling conditions match', () => {
    const schema: CredentialFormSchema[] = [
      textSchema({ name: 'mode', variable: 'mode' }),
      textSchema({
        name: 'extra',
        variable: 'extra',
        show_on: [{ variable: 'mode', value: 'pro' }],
      }),
    ]
    const value: ToolVarInputs = {
      mode: { type: VarKindType.constant, value: 'pro' },
      extra: { type: VarKindType.constant, value: 'x' },
    }

    render(
      <ToolForm
        readOnly={false}
        nodeId="n1"
        schema={schema}
        value={value}
        onChange={vi.fn()}
      />,
    )

    expect(document.querySelector('[data-testid="tool-field-extra"]')).not.toBeNull()
  })

  it('should reset hidden dependent fields to schema defaults when conditions flip off', () => {
    const onChange = vi.fn()
    const schema: CredentialFormSchema[] = [
      textSchema({ name: 'mode', variable: 'mode', default: 'free' }),
      textSchema({
        name: 'extra',
        variable: 'extra',
        show_on: [{ variable: 'mode', value: 'pro' }],
        default: 'reset-default',
      }),
    ]
    const visibleValue: ToolVarInputs = {
      mode: { type: VarKindType.constant, value: 'pro' },
      extra: { type: VarKindType.constant, value: 'edited' },
    }

    const { rerender } = render(
      <ToolForm
        readOnly={false}
        nodeId="n1"
        schema={schema}
        value={visibleValue}
        onChange={onChange}
      />,
    )

    rerender(
      <ToolForm
        readOnly={false}
        nodeId="n1"
        schema={schema}
        value={{
          mode: { type: VarKindType.constant, value: 'free' },
          extra: { type: VarKindType.constant, value: 'edited' },
        }}
        onChange={onChange}
      />,
    )

    expect(onChange).toHaveBeenCalled()
    const patched = onChange.mock.calls.at(-1)?.[0] as ToolVarInputs
    expect(patched.extra).toEqual({
      type: VarKindType.mixed,
      value: 'reset-default',
    })
  })
})
