import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { VarType } from '@/app/components/workflow/types'
import { WriteMode } from '../../types'
import OperationSelector from '../operation-selector'

describe('assigner/operation-selector', () => {
  it('shows numeric write modes and emits the selected operation', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()

    render(
      <OperationSelector
        value={WriteMode.overwrite}
        onSelect={onSelect}
        assignedVarType={VarType.number}
        writeModeTypes={[WriteMode.overwrite, WriteMode.clear, WriteMode.set]}
        writeModeTypesArr={[WriteMode.overwrite, WriteMode.clear]}
        writeModeTypesNum={[WriteMode.increment]}
      />,
    )

    await user.click(screen.getByText('workflow.nodes.assigner.operations.over-write'))

    expect(screen.getByText('workflow.nodes.assigner.operations.title')).toBeInTheDocument()
    expect(screen.getByText('workflow.nodes.assigner.operations.clear')).toBeInTheDocument()
    expect(screen.getByText('workflow.nodes.assigner.operations.set')).toBeInTheDocument()
    expect(screen.getByText('workflow.nodes.assigner.operations.+=')).toBeInTheDocument()

    await user.click(screen.getAllByText('workflow.nodes.assigner.operations.+=').at(-1)!)

    expect(onSelect).toHaveBeenCalledWith({ value: WriteMode.increment, name: WriteMode.increment })
  })

  it('does not open when the selector is disabled', async () => {
    const user = userEvent.setup()

    render(
      <OperationSelector
        value={WriteMode.overwrite}
        onSelect={vi.fn()}
        disabled
        assignedVarType={VarType.string}
        writeModeTypes={[WriteMode.overwrite]}
      />,
    )

    await user.click(screen.getByText('workflow.nodes.assigner.operations.over-write'))

    expect(screen.queryByText('workflow.nodes.assigner.operations.title')).not.toBeInTheDocument()
  })
})
