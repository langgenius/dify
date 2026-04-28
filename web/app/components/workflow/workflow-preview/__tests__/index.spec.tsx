import { render, waitFor } from '@testing-library/react'
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
        <WorkflowPreview
          nodes={[]}
          edges={[]}
          viewport={defaultViewport}
          miniMapToRight
        />
      </div>,
    )

    await waitFor(() => expect(container.querySelector('.react-flow__minimap')).toBeInTheDocument())

    expect(container.querySelector('.react-flow__minimap')).toHaveClass('right-4!')
    expect(container.querySelector('.react-flow__minimap')).not.toHaveClass('left-4!')
  })
})
