import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import Title from '../title'

describe('OnlineDocumentTitle', () => {
  it('should render title with name prop', () => {
    render(<Title name="Notion Workspace" />)
    expect(screen.getByText('datasetPipeline.onlineDocument.pageSelectorTitle:{"name":"Notion Workspace"}')).toBeInTheDocument()
  })
})
