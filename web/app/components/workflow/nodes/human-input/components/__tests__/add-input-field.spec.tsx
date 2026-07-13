import type { FormInputItem } from '../../types'
import { fireEvent, render, screen } from '@testing-library/react'
import { InputVarType } from '@/app/components/workflow/types'
import AddInputField from '../add-input-field'

const mockInputField = vi.hoisted(() => vi.fn())

vi.mock('@/app/components/base/prompt-editor/plugins/hitl-input-block/input-field', () => ({
  __esModule: true,
  default: (props: {
    nodeId: string
    isEdit: boolean
    unavailableVariableNames?: string[]
    onChange: (newPayload: FormInputItem) => void
    onCancel: () => void
  }) => {
    mockInputField(props)
    return (
      <div>
        <button
          type="button"
          onClick={() =>
            props.onChange({
              type: InputVarType.paragraph,
              output_variable_name: 'comment',
              default: {
                type: 'constant',
                selector: [],
                value: '',
              },
            })
          }
        >
          save
        </button>
        <button type="button" onClick={props.onCancel}>
          cancel
        </button>
      </div>
    )
  },
}))

describe('human-input/components/add-input-field', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render InputField in create mode and forward callbacks', () => {
    const handleSave = vi.fn()
    const handleCancel = vi.fn()

    render(
      <AddInputField
        nodeId="human-node"
        unavailableVariableNames={['comment']}
        onSave={handleSave}
        onCancel={handleCancel}
      />,
    )

    expect(mockInputField).toHaveBeenCalledWith(
      expect.objectContaining({
        nodeId: 'human-node',
        isEdit: false,
        unavailableVariableNames: ['comment'],
        onChange: handleSave,
        onCancel: handleCancel,
      }),
    )

    fireEvent.click(screen.getByRole('button', { name: 'save' }))
    expect(handleSave).toHaveBeenCalledWith(
      expect.objectContaining({
        type: InputVarType.paragraph,
        output_variable_name: 'comment',
      }),
    )

    fireEvent.click(screen.getByRole('button', { name: 'cancel' }))
    expect(handleCancel).toHaveBeenCalledTimes(1)
  })
})
