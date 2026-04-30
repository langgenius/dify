import { fireEvent, render, screen } from '@testing-library/react'
import { ChunkStructureEnum } from '../../../types'
import Selector from '../selector'

const options = [
  {
    id: ChunkStructureEnum.general,
    icon: <span>G</span>,
    title: 'General',
    description: 'General description',
    effectColor: 'blue',
  },
  {
    id: ChunkStructureEnum.parent_child,
    icon: <span>P</span>,
    title: 'Parent child',
    description: 'Parent child description',
    effectColor: 'purple',
  },
]

describe('ChunkStructureSelector', () => {
  it('should open the selector panel and close it after selecting an option', () => {
    const onChange = vi.fn()

    render(
      <Selector
        options={options}
        value={ChunkStructureEnum.general}
        onChange={onChange}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'workflow.panel.change' }))

    expect(screen.getByText('workflow.nodes.knowledgeBase.changeChunkStructure')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Parent child'))

    expect(onChange).toHaveBeenCalledWith(ChunkStructureEnum.parent_child)
    expect(screen.queryByText('workflow.nodes.knowledgeBase.changeChunkStructure')).not.toBeInTheDocument()
  })

  it('should not open the selector when readonly is enabled', () => {
    render(
      <Selector
        options={options}
        onChange={vi.fn()}
        readonly
        trigger={<button type="button">custom-trigger</button>}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'custom-trigger' }))

    expect(screen.queryByText('workflow.nodes.knowledgeBase.changeChunkStructure')).not.toBeInTheDocument()
  })
})
