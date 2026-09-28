import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useKeyPress } from 'reactflow'
import { ChunkStructureEnum } from '../../../types'
import Selector from '../selector'

// Exercise the same document-level shortcut mounted by the workflow canvas.
function CanvasPanShortcut() {
  useKeyPress('Space')
  return null
}

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
  it('should open the selector panel and close it after selecting an option', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(
      <>
        <CanvasPanShortcut />
        <Selector options={options} value={ChunkStructureEnum.general} onChange={onChange} />
      </>,
    )

    await user.click(screen.getByRole('button', { name: 'workflow.panel.change' }))

    expect(
      screen.getByRole('dialog', { name: 'workflow.nodes.knowledgeBase.changeChunkStructure' }),
    ).toBeInTheDocument()

    expect(screen.getByRole('button', { name: /General/, pressed: true })).toBeInTheDocument()
    const choice = screen.getByRole('button', { name: /Parent child/, pressed: false })
    choice.focus()
    await user.keyboard(' ')

    expect(onChange).toHaveBeenCalledWith(ChunkStructureEnum.parent_child)
    await waitFor(() => {
      expect(
        screen.queryByText('workflow.nodes.knowledgeBase.changeChunkStructure'),
      ).not.toBeInTheDocument()
    })
  })

  it('should expose one custom trigger and open it from the keyboard', async () => {
    const user = userEvent.setup()
    render(
      <>
        <CanvasPanShortcut />
        <Selector
          options={options}
          onChange={vi.fn()}
          trigger={<button type="button">Choose structure</button>}
        />
      </>,
    )
    expect(screen.getAllByRole('button')).toHaveLength(1)
    await user.tab()
    expect(screen.getByRole('button', { name: 'Choose structure' })).toHaveFocus()
    await user.keyboard(' ')
    expect(await screen.findByRole('button', { name: /General/ })).toBeInTheDocument()
  })

  it('should not open the selector when readonly is enabled', async () => {
    const user = userEvent.setup()
    render(
      <Selector
        options={options}
        onChange={vi.fn()}
        readonly
        trigger={<button type="button">custom-trigger</button>}
      />,
    )

    const trigger = screen.getByRole('button', { name: 'custom-trigger' })
    expect(trigger).toBeDisabled()
    await user.click(trigger)

    expect(
      screen.queryByText('workflow.nodes.knowledgeBase.changeChunkStructure'),
    ).not.toBeInTheDocument()
  })
})
