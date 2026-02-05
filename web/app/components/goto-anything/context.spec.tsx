import { render, screen, waitFor } from '@testing-library/react'
import * as React from 'react'
import { GotoAnythingProvider, useGotoAnythingContext } from './context'

let pathnameMock: string | null | undefined = '/'
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

  it('should set both flags to false when pathname is null', async () => {
    pathnameMock = null

    render(
      <GotoAnythingProvider>
        <ContextConsumer />
      </GotoAnythingProvider>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('false|false')
    })
  })

  it('should set both flags to false when pathname is undefined', async () => {
    pathnameMock = undefined

    render(
      <GotoAnythingProvider>
        <ContextConsumer />
      </GotoAnythingProvider>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('false|false')
    })
  })

  it('should set both flags to false for regular paths', async () => {
    pathnameMock = '/apps'

    render(
      <GotoAnythingProvider>
        <ContextConsumer />
      </GotoAnythingProvider>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('false|false')
    })
  })

  it('should NOT match non-pipeline dataset paths', async () => {
    pathnameMock = '/datasets/abc/documents'

    render(
      <GotoAnythingProvider>
        <ContextConsumer />
      </GotoAnythingProvider>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('false|false')
    })
  })
})

describe('useGotoAnythingContext', () => {
  it('should return default values when used outside provider', () => {
    const TestComponent = () => {
      const { isWorkflowPage, isRagPipelinePage } = useGotoAnythingContext()
      return (
        <div data-testid="context">
          {String(isWorkflowPage)}
          |
          {String(isRagPipelinePage)}
        </div>
      )
    }

    render(<TestComponent />)

    expect(screen.getByTestId('context')).toHaveTextContent('false|false')
  })
})
