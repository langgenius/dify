import { render, screen } from '@testing-library/react'
import { createNode } from '@/app/components/workflow/__tests__/fixtures'
import { BlockEnum } from '@/app/components/workflow/types'
import WorkflowPreview from '../index'

const defaultViewport = {
  x: 0,
  y: 0,
  zoom: 1,
}

describe('WorkflowPreview', () => {
  it('renders a portable Agent v2 node with its title and description', async () => {
    render(
      <div style={{ width: 800, height: 600 }}>
        <WorkflowPreview
          nodes={[
            createNode({
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
            }),
          ]}
          edges={[]}
          viewport={defaultViewport}
        />
      </div>,
    )

    expect(await screen.findByText('Research Agent')).toBeInTheDocument()
    expect(screen.getByText('Handles research tasks')).toBeInTheDocument()
  })
})
