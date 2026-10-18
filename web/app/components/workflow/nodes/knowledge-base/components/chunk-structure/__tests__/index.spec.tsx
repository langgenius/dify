import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import { ChunkStructureEnum } from '../../../types'
import ChunkStructure from '../index'

it('selects an initial chunk structure and changes it through the selected-card action', async () => {
  const user = userEvent.setup()
  const onChange = vi.fn()
  function Harness() {
    const [structure, setStructure] = useState<ChunkStructureEnum>()
    return (
      <ChunkStructure
        chunkStructure={structure}
        onChunkStructureChange={(next) => {
          setStructure(next)
          onChange(next)
        }}
      />
    )
  }
  render(<Harness />)
  await user.click(
    screen.getByRole('button', { name: 'workflow.nodes.knowledgeBase.chooseChunkStructure' }),
  )
  await user.click(screen.getByRole('button', { name: /datasetCreation.stepTwo.general/ }))
  expect(onChange).toHaveBeenLastCalledWith(ChunkStructureEnum.general)
  await waitFor(() =>
    expect(
      screen.queryByText('workflow.nodes.knowledgeBase.changeChunkStructure'),
    ).not.toBeInTheDocument(),
  )
  expect(screen.getByText('datasetCreation.stepTwo.general')).toBeInTheDocument()

  await user.click(screen.getByRole('button', { name: 'workflow.panel.change' }))
  await user.click(screen.getByRole('button', { name: /datasetCreation.stepTwo.parentChild/ }))
  expect(onChange).toHaveBeenLastCalledWith(ChunkStructureEnum.parent_child)
  await waitFor(() =>
    expect(
      screen.queryByText('workflow.nodes.knowledgeBase.changeChunkStructure'),
    ).not.toBeInTheDocument(),
  )
  expect(screen.getByText('datasetCreation.stepTwo.parentChild')).toBeInTheDocument()
  expect(screen.queryByText('datasetCreation.stepTwo.general')).not.toBeInTheDocument()
})
