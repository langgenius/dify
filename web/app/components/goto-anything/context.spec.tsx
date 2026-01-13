import { render, screen, waitFor } from '@testing-library/react'
import * as React from 'react'
import { GotoAnythingProvider, useGotoAnythingContext } from './context'

let pathnameMock = '/'
vi.mock('next/navigation', () => ({
  usePathname: () => pathnameMock,
}))

let isWorkflowPageMock = false
vi.mock('../workflow/constants', () => ({
  isInWorkflowPage: () => isWorkflowPageMock,
}))

const ContextConsumer = () => {
  const { isWorkflowPage, isRagPipelinePage } = useGotoAnythingContext()
  return (
    <div data-testid="status">
      {String(isWorkflowPage)}
      |
      {String(isRagPipelinePage)}
    </div>
  )
}

describe('GotoAnythingProvider', () => {
  beforeEach(() => {
    isWorkflowPageMock = false
    pathnameMock = '/'
  })

  it('should set workflow page flag when workflow path detected', async () => {
    isWorkflowPageMock = true
    pathnameMock = '/app/123/workflow'

    render(
      <GotoAnythingProvider>
        <ContextConsumer />
      </GotoAnythingProvider>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('true|false')
    })
  })

  it('should detect RAG pipeline path based on pathname', async () => {
    pathnameMock = '/datasets/abc/pipeline'

    render(
      <GotoAnythingProvider>
        <ContextConsumer />
      </GotoAnythingProvider>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('false|true')
    })
  })
})
