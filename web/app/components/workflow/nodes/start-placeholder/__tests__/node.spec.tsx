import { render, screen } from '@testing-library/react'
import { BlockEnum } from '@/app/components/workflow/types'
import Node from '../node'

describe('StartPlaceholderNode', () => {
  it('should show the right-panel hint while selected and the click hint after the panel closes', () => {
    const { rerender } = render(
      <Node
        id="start-placeholder"
        data={
          {
            type: BlockEnum.StartPlaceholder,
            selected: true,
          } as never
        }
      />,
    )

    expect(screen.getByText('workflow.nodes.startPlaceholder.nodeDescription')).toBeInTheDocument()

    rerender(
      <Node
        id="start-placeholder"
        data={
          {
            type: BlockEnum.StartPlaceholder,
            selected: false,
          } as never
        }
      />,
    )

    expect(
      screen.getByText('workflow.nodes.startPlaceholder.nodeCollapsedDescription'),
    ).toBeInTheDocument()
  })
})
