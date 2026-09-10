import { render, screen, waitFor } from '@testing-library/react'
import { BlockEnum } from '@/app/components/workflow/types'
import WorkflowPreview from '../index'

const defaultViewport = {
  x: 0,
  y: 0,
  zoom: 1,
}

describe('WorkflowPreview', () => {
  it('should render the preview container with the default left minimap placement', async () => {
    const { container } = render(
      <div style={{ width: 800, height: 600 }}>
        <WorkflowPreview
          nodes={[]}
          edges={[]}
          viewport={defaultViewport}
          className="preview-shell"
        />
      </div>,
    )

    await waitFor(() => expect(container.querySelector('.react-flow__minimap')).toBeInTheDocument())

    expect(container.querySelector('#workflow-container')).toHaveClass('preview-shell')
    expect(container.querySelector('.react-flow__background')).toBeInTheDocument()
    expect(container.querySelector('.react-flow__minimap')).toHaveClass('left-4!')
  })

  it('should move the minimap to the right when requested', async () => {
    const { container } = render(
      <div style={{ width: 800, height: 600 }}>
        <WorkflowPreview nodes={[]} edges={[]} viewport={defaultViewport} miniMapToRight />
      </div>,
    )

    await waitFor(() => expect(container.querySelector('.react-flow__minimap')).toBeInTheDocument())

    expect(container.querySelector('.react-flow__minimap')).toHaveClass('right-4!')
    expect(container.querySelector('.react-flow__minimap')).not.toHaveClass('left-4!')
  })

  it('should render a portable Agent v2 node without failing the preview', async () => {
    render(
      <div style={{ width: 800, height: 600 }}>
        <WorkflowPreview
          nodes={
            [
              {
                id: 'agent-v2-1',
                type: 'custom',
                position: { x: 100, y: 100 },
                data: {
                  type: BlockEnum.Agent,
                  version: '2',
                  agent_node_kind: 'dify_agent',
                  title: 'Research Agent',
                  desc: 'Handles research tasks',
                  agent_binding: {
                    binding_type: 'roster_agent',
                    package_ref: 'agent_1',
                  },
                },
              },
            ] as never
          }
          edges={[]}
          viewport={defaultViewport}
        />
      </div>,
    )

    expect(await screen.findByText('Research Agent')).toBeInTheDocument()
    expect(screen.getByText('Handles research tasks')).toBeInTheDocument()
  })
})
