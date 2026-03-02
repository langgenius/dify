import type { RefObject } from 'react'
import type { FormInputItem } from '@/app/components/workflow/nodes/human-input/types'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { InputVarType } from '@/app/components/workflow/types'
import HITLInputComponent from './component'

const { mockUseSelectOrDelete } = vi.hoisted(() => ({
  mockUseSelectOrDelete: vi.fn(),
}))

vi.mock('../../hooks', () => ({
  useSelectOrDelete: (...args: unknown[]) => mockUseSelectOrDelete(...args),
}))

vi.mock('./component-ui', () => ({
  default: ({ formInput, onChange }: { formInput?: FormInputItem, onChange: (payload: FormInputItem) => void }) => {
    const basePayload: FormInputItem = formInput ?? {
      type: InputVarType.paragraph,
      output_variable_name: 'user_name',
      default: {
        type: 'constant',
        selector: [],
        value: 'hello',
      },
    }
    return (
      <div>
        <button
          type="button"
          onClick={() => onChange(basePayload)}
        >
          emit-same-name
        </button>
        <button
          type="button"
          onClick={() => onChange({
            ...basePayload,
            output_variable_name: 'renamed_name',
          })}
        >
          emit-rename
        </button>
        <button
          type="button"
          onClick={() => onChange({
            ...basePayload,
            default: {
              type: 'constant',
              selector: [],
              value: 'updated',
            },
          })}
        >
          emit-update
        </button>
      </div>
    )
  },
}))

const createHookReturn = (): [RefObject<HTMLDivElement | null>, boolean] => {
  return [{ current: null }, false]
}

const createInput = (overrides?: Partial<FormInputItem>): FormInputItem => ({
  type: InputVarType.paragraph,
  output_variable_name: 'user_name',
  default: {
    type: 'constant',
    selector: [],
    value: 'hello',
  },
  ...overrides,
})

describe('HITLInputComponent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseSelectOrDelete.mockReturnValue(createHookReturn())
  })

  it('should append payload when matching form input does not exist', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(
      <HITLInputComponent
        nodeKey="node-key-1"
        nodeId="node-1"
        varName="user_name"
        formInputs={[]}
        onChange={onChange}
        onRename={vi.fn()}
        onRemove={vi.fn()}
        workflowNodesMap={{}}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'emit-same-name' }))

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange.mock.calls[0][0]).toHaveLength(1)
    expect(onChange.mock.calls[0][0][0].output_variable_name).toBe('user_name')
  })

  it('should replace payload when variable name is renamed', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(
      <HITLInputComponent
        nodeKey="node-key-2"
        nodeId="node-2"
        varName="user_name"
        formInputs={[createInput()]}
        onChange={onChange}
        onRename={vi.fn()}
        onRemove={vi.fn()}
        workflowNodesMap={{}}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'emit-rename' }))

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange.mock.calls[0][0][0].output_variable_name).toBe('renamed_name')
  })

  it('should update existing payload when variable name stays the same', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(
      <HITLInputComponent
        nodeKey="node-key-3"
        nodeId="node-3"
        varName="user_name"
        formInputs={[createInput()]}
        onChange={onChange}
        onRename={vi.fn()}
        onRemove={vi.fn()}
        workflowNodesMap={{}}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'emit-update' }))

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange.mock.calls[0][0][0].default.value).toBe('updated')
    expect(onChange.mock.calls[0][0][0].output_variable_name).toBe('user_name')
  })
})
