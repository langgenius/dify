import type { ComponentProps } from 'react'
import type { Var } from '@/app/components/workflow/types'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { VarType } from '@/app/components/workflow/types'
import VarGroupItem from '../var-group-item'

const mockPickerRender = vi.hoisted(() => vi.fn())
const mockVarListRender = vi.hoisted(() => vi.fn())

vi.mock('../../../_base/components/variable/var-reference-picker', () => ({
  __esModule: true,
  default: (props: {
    onChange: (value: string[], varKindType: string, varInfo?: Var) => void
    filterVar: (payload: Var) => boolean
  }) => {
    mockPickerRender(props)
    return (
      <div>
        <button
          type="button"
          onClick={() => props.onChange(['node-a', 'answer'], 'variable', {
            variable: 'answer',
            type: VarType.string,
          })}
        >
          add-string-var
        </button>
        <button
          type="button"
          onClick={() => props.onChange(['node-a', 'answer'], 'variable', {
            variable: 'answer',
            type: VarType.string,
          })}
        >
          add-duplicate-var
        </button>
      </div>
    )
  },
}))

vi.mock('../var-list', () => ({
  __esModule: true,
  default: (props: {
    onChange: (list: string[][], changedItem?: string[]) => void
  }) => {
    mockVarListRender(props)
    return (
      <div>
        <button
          type="button"
          onClick={() => props.onChange([
            ['node-a', 'flag'],
            ['node-a', 'flag'],
          ], ['node-a', 'flag'])}
        >
          replace-with-duplicate
        </button>
        <button
          type="button"
          onClick={() => props.onChange([], undefined)}
        >
          clear-vars
        </button>
      </div>
    )
  },
}))

const createPayload = (
  overrides: Partial<ComponentProps<typeof VarGroupItem>['payload']> = {},
): ComponentProps<typeof VarGroupItem>['payload'] => ({
  group_name: 'Group_A',
  output_type: VarType.any,
  variables: [],
  ...overrides,
})

const renderGroupItem = (props: Partial<ComponentProps<typeof VarGroupItem>> = {}) => {
  const onChange = vi.fn()

  render(
    <VarGroupItem
      readOnly={false}
      nodeId="node-1"
      payload={createPayload()}
      onChange={onChange}
      groupEnabled
      availableVars={[]}
      {...props}
    />,
  )

  return { onChange }
}

describe('variable-assigner/var-group-item branches', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('adds a new typed variable and exposes permissive filtering when output type is any', async () => {
    const user = userEvent.setup()
    const { onChange } = renderGroupItem()

    const filterVar = mockPickerRender.mock.lastCall?.[0].filterVar as (payload: Var) => boolean

    expect(filterVar({ variable: 'answer', type: VarType.string })).toBe(true)
    expect(filterVar({ variable: 'flag', type: VarType.boolean })).toBe(true)

    await user.click(screen.getByRole('button', { name: 'add-string-var' }))

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      variables: [['node-a', 'answer']],
      output_type: VarType.string,
    }))
  })

  it('ignores duplicate additions and only accepts matching types when the output type is fixed', async () => {
    const user = userEvent.setup()
    const { onChange } = renderGroupItem({
      payload: createPayload({
        output_type: VarType.string,
        variables: [['node-a', 'answer']],
      }),
    })

    const filterVar = mockPickerRender.mock.lastCall?.[0].filterVar as (payload: Var) => boolean

    expect(filterVar({ variable: 'answer', type: VarType.string })).toBe(true)
    expect(filterVar({ variable: 'flag', type: VarType.boolean })).toBe(false)

    await user.click(screen.getByRole('button', { name: 'add-duplicate-var' }))

    expect(onChange).not.toHaveBeenCalled()
  })

  it('ignores duplicate replacements from the nested variable list', async () => {
    const user = userEvent.setup()
    const { onChange } = renderGroupItem({
      payload: createPayload({
        output_type: VarType.string,
        variables: [['node-a', 'answer'], ['node-a', 'flag']],
      }),
    })

    await user.click(screen.getByRole('button', { name: 'replace-with-duplicate' }))

    expect(onChange).not.toHaveBeenCalled()
  })

  it('resets the output type to any when the nested variable list becomes empty', async () => {
    const user = userEvent.setup()
    const { onChange } = renderGroupItem({
      payload: createPayload({
        output_type: VarType.string,
        variables: [['node-a', 'answer']],
      }),
    })

    await user.click(screen.getByRole('button', { name: 'clear-vars' }))

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      variables: [],
      output_type: VarType.any,
    }))
  })
})
