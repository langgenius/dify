import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import WorkflowPreviewCard from '../workflow-preview-card'

describe('WorkflowPreviewCard', () => {
  it('should render the workflow preview with execute action and branding footer', () => {
    render(
      <WorkflowPreviewCard
        imgKey={9}
        workspaceLogo="https://example.com/workspace-logo.png"
      />,
    )

    expect(screen.getByText('Workflow App')).toBeInTheDocument()
    expect(screen.getByText('RUN ONCE')).toBeInTheDocument()
    expect(screen.getByText('RUN BATCH')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Execute/i })).toBeDisabled()
    expect(screen.getByAltText('logo')).toHaveAttribute('src', 'https://example.com/workspace-logo.png')
  })

  it('should hide workflow branding footer when brand removal is enabled', () => {
    render(
      <WorkflowPreviewCard
        imgKey={9}
        webappBrandRemoved
        workspaceLogo="https://example.com/workspace-logo.png"
      />,
    )

    expect(screen.queryByText('POWERED BY')).not.toBeInTheDocument()
  })
})
