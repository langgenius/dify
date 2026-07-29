import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import * as React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import StatusItem from '../index'

const toastMocks = vi.hoisted(() => {
  const record = vi.fn()
  const api = vi.fn((message: unknown, options?: Record<string, unknown>) =>
    record({ message, ...options }),
  )
  return {
    record,
    api: Object.assign(api, {
      success: vi.fn((message: unknown, options?: Record<string, unknown>) =>
        record({ type: 'success', message, ...options }),
      ),
      error: vi.fn((message: unknown, options?: Record<string, unknown>) =>
        record({ type: 'error', message, ...options }),
      ),
      warning: vi.fn((message: unknown, options?: Record<string, unknown>) =>
        record({ type: 'warning', message, ...options }),
      ),
      info: vi.fn((message: unknown, options?: Record<string, unknown>) =>
        record({ type: 'info', message, ...options }),
      ),
      dismiss: vi.fn(),
      update: vi.fn(),
      promise: vi.fn(),
    }),
  }
})
vi.mock('use-context-selector', () => ({
  createContext: (defaultValue: unknown) => React.createContext(defaultValue),
  useContext: () => ({
    notify: toastMocks.api,
  }),
  useContextSelector: (context: unknown, selector: (state: unknown) => unknown) => selector({}),
}))

vi.mock('@langgenius/dify-ui/toast', () => ({
  toast: toastMocks.api,
}))

// Mock useIndexStatus hook
vi.mock('../hooks', () => ({
  useIndexStatus: () => ({
    queuing: { text: 'Queuing', status: 'warning' },
    indexing: { text: 'Indexing', status: 'normal' },
    paused: { text: 'Paused', status: 'warning' },
    error: { text: 'Error', status: 'error' },
    available: { text: 'Available', status: 'success' },
    enabled: { text: 'Enabled', status: 'success' },
    disabled: { text: 'Disabled', status: 'disabled' },
    archived: { text: 'Archived', status: 'disabled' },
  }),
}))

const mockEnable = vi.fn()
const mockDisable = vi.fn()
const mockDelete = vi.fn()

vi.mock('@/service/knowledge/use-document', () => ({
  useDocumentEnable: () => ({ mutateAsync: mockEnable }),
  useDocumentDisable: () => ({ mutateAsync: mockDisable }),
  useDocumentDelete: () => ({ mutateAsync: mockDelete }),
}))

beforeEach(() => {
  vi.clearAllMocks()
  mockEnable.mockResolvedValue({})
  mockDisable.mockResolvedValue({})
  mockDelete.mockResolvedValue({})
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('StatusItem', () => {
  const mockOnUpdate = vi.fn()

  describe('rendering', () => {
    it('should render available status', () => {
      render(<StatusItem status="available" />)
      expect(screen.getByText('Available')).toBeInTheDocument()
    })

    it('should render error status', () => {
      render(<StatusItem status="error" />)
      expect(screen.getByText('Error')).toBeInTheDocument()
    })

    it('should render indexing status', () => {
      render(<StatusItem status="indexing" />)
      expect(screen.getByText('Indexing')).toBeInTheDocument()
    })

    it('should render queuing status', () => {
      render(<StatusItem status="queuing" />)
      expect(screen.getByText('Queuing')).toBeInTheDocument()
    })

    it('should render paused status', () => {
      render(<StatusItem status="paused" />)
      expect(screen.getByText('Paused')).toBeInTheDocument()
    })

    it('should render enabled status', () => {
      render(<StatusItem status="enabled" />)
      expect(screen.getByText('Enabled')).toBeInTheDocument()
    })

    it('should render disabled status', () => {
      render(<StatusItem status="disabled" />)
      expect(screen.getByText('Disabled')).toBeInTheDocument()
    })

    it('should render archived status', () => {
      render(<StatusItem status="archived" />)
      expect(screen.getByText('Archived')).toBeInTheDocument()
    })
  })

  describe('error message tooltip', () => {
    it('should show tooltip trigger when error message is provided', () => {
      render(<StatusItem status="error" errorMessage="Test error message" />)
      expect(screen.getByLabelText('Test error message')).toBeInTheDocument()
    })

    it('should not show tooltip trigger when no error message', () => {
      render(<StatusItem status="error" />)
      expect(screen.queryByLabelText('Test error message')).not.toBeInTheDocument()
    })
  })

  describe('detail scene', () => {
    it('should render switch in detail scene', () => {
      render(
        <StatusItem
          status="available"
          scene="detail"
          detail={{
            enabled: true,
            archived: false,
            id: 'doc-1',
          }}
          datasetId="dataset-1"
          canEdit
        />,
      )
      // Switch component should be present in detail scene
      const switchElement = document.querySelector('[role="switch"]')
      expect(switchElement).toBeInTheDocument()
    })

    it('should not show switch in list scene', () => {
      render(<StatusItem status="available" scene="list" />)
      // Should only have basic indicator without switch
      const switchElement = document.querySelector('[role="switch"]')
      expect(switchElement).not.toBeInTheDocument()
    })

    it('should render switch as disabled when archived', () => {
      render(
        <StatusItem
          status="available"
          scene="detail"
          detail={{
            enabled: true,
            archived: true,
            id: 'doc-1',
          }}
          datasetId="dataset-1"
          canEdit
        />,
      )
      const switchElement = screen.getByRole('switch')
      expect(switchElement).toHaveAttribute('aria-disabled', 'true')
    })

    it('should render switch as disabled when embedding (queuing status)', () => {
      render(
        <StatusItem
          status="queuing"
          scene="detail"
          detail={{
            enabled: true,
            archived: false,
            id: 'doc-1',
          }}
          datasetId="dataset-1"
          canEdit
        />,
      )
      const switchElement = screen.getByRole('switch')
      expect(switchElement).toHaveAttribute('aria-disabled', 'true')
    })

    it('should render switch as disabled when embedding (indexing status)', () => {
      render(
        <StatusItem
          status="indexing"
          scene="detail"
          detail={{
            enabled: true,
            archived: false,
            id: 'doc-1',
          }}
          datasetId="dataset-1"
          canEdit
        />,
      )
      const switchElement = screen.getByRole('switch')
      expect(switchElement).toHaveAttribute('aria-disabled', 'true')
    })

    it('should render switch as disabled when embedding (paused status)', () => {
      render(
        <StatusItem
          status="paused"
          scene="detail"
          detail={{
            enabled: true,
            archived: false,
            id: 'doc-1',
          }}
          datasetId="dataset-1"
        />,
      )
      const switchElement = screen.getByRole('switch')
      expect(switchElement).toHaveAttribute('aria-disabled', 'true')
    })

    it('should render switch as disabled when canEdit is false', () => {
      render(
        <StatusItem
          status="available"
          scene="detail"
          detail={{
            enabled: true,
            archived: false,
            id: 'doc-1',
          }}
          datasetId="dataset-1"
          canEdit={false}
        />,
      )
      const switchElement = screen.getByRole('switch')
      expect(switchElement).toHaveAttribute('aria-disabled', 'true')
    })
  })

  describe('switch operations', () => {
    it('should call enable when switch is toggled on', async () => {
      vi.useFakeTimers()
      render(
        <StatusItem
          status="available"
          scene="detail"
          detail={{
            enabled: false,
            archived: false,
            id: 'doc-1',
          }}
          datasetId="dataset-1"
          canEdit
          onUpdate={mockOnUpdate}
        />,
      )
      const switchElement = document.querySelector('[role="switch"]')
      await act(async () => {
        fireEvent.click(switchElement!)
      })
      // Wait for debounce
      await act(async () => {
        vi.advanceTimersByTime(600)
      })
      expect(mockEnable).toHaveBeenCalledWith({ datasetId: 'dataset-1', documentId: 'doc-1' })
      vi.useRealTimers()
    })

    it('should call disable when switch is toggled off', async () => {
      vi.useFakeTimers()
      render(
        <StatusItem
          status="available"
          scene="detail"
          detail={{
            enabled: true,
            archived: false,
            id: 'doc-1',
          }}
          datasetId="dataset-1"
          canEdit
          onUpdate={mockOnUpdate}
        />,
      )
      const switchElement = document.querySelector('[role="switch"]')
      await act(async () => {
        fireEvent.click(switchElement!)
      })
      // Wait for debounce
      await act(async () => {
        vi.advanceTimersByTime(600)
      })
      expect(mockDisable).toHaveBeenCalledWith({ datasetId: 'dataset-1', documentId: 'doc-1' })
      vi.useRealTimers()
    })

    it('should not call switch when archived', async () => {
      vi.useFakeTimers()
      render(
        <StatusItem
          status="available"
          scene="detail"
          detail={{
            enabled: true,
            archived: true,
            id: 'doc-1',
          }}
          datasetId="dataset-1"
          canEdit
          onUpdate={mockOnUpdate}
        />,
      )
      const switchElement = document.querySelector('[role="switch"]')
      await act(async () => {
        fireEvent.click(switchElement!)
      })
      await act(async () => {
        vi.advanceTimersByTime(600)
      })
      // Should not call any operation because archived is true
      expect(mockEnable).not.toHaveBeenCalled()
      expect(mockDisable).not.toHaveBeenCalled()
      vi.useRealTimers()
    })

    it('should show success notification after successful operation', async () => {
      vi.useFakeTimers()
      render(
        <StatusItem
          status="available"
          scene="detail"
          detail={{
            enabled: false,
            archived: false,
            id: 'doc-1',
          }}
          datasetId="dataset-1"
          canEdit
          onUpdate={mockOnUpdate}
        />,
      )
      const switchElement = document.querySelector('[role="switch"]')
      await act(async () => {
        fireEvent.click(switchElement!)
      })
      await act(async () => {
        vi.advanceTimersByTime(600)
        // Flush promises
        await Promise.resolve()
      })
      expect(toastMocks.record).toHaveBeenCalledWith({
        type: 'success',
        message: 'common.actionMsg.modifiedSuccessfully',
      })
      vi.useRealTimers()
    })

    it('should call onUpdate after successful operation', async () => {
      vi.useFakeTimers()
      render(
        <StatusItem
          status="available"
          scene="detail"
          detail={{
            enabled: false,
            archived: false,
            id: 'doc-1',
          }}
          datasetId="dataset-1"
          canEdit
          onUpdate={mockOnUpdate}
        />,
      )
      const switchElement = document.querySelector('[role="switch"]')
      await act(async () => {
        fireEvent.click(switchElement!)
      })
      await act(async () => {
        vi.advanceTimersByTime(600)
        // Flush promises
        await Promise.resolve()
      })
      expect(mockOnUpdate).toHaveBeenCalledWith('enable')
      vi.useRealTimers()
    })

    it('should show error notification when operation fails', async () => {
      vi.useFakeTimers()
      mockEnable.mockRejectedValue(new Error('API Error'))
      render(
        <StatusItem
          status="available"
          scene="detail"
          detail={{
            enabled: false,
            archived: false,
            id: 'doc-1',
          }}
          datasetId="dataset-1"
          canEdit
          onUpdate={mockOnUpdate}
        />,
      )
      const switchElement = document.querySelector('[role="switch"]')
      await act(async () => {
        fireEvent.click(switchElement!)
      })
      await act(async () => {
        vi.advanceTimersByTime(600)
        // Flush promises
        await Promise.resolve()
      })
      expect(toastMocks.record).toHaveBeenCalledWith({
        type: 'error',
        message: 'common.actionMsg.modifiedUnsuccessfully',
      })
      vi.useRealTimers()
    })
  })

  describe('default props', () => {
    it('should work with default datasetId', () => {
      render(
        <StatusItem
          status="available"
          scene="detail"
          detail={{
            enabled: true,
            archived: false,
            id: 'doc-1',
          }}
        />,
      )
      const switchElement = document.querySelector('[role="switch"]')
      expect(switchElement).toBeInTheDocument()
    })

    it('should work without detail prop', () => {
      render(<StatusItem status="available" />)
      expect(screen.getByText('Available')).toBeInTheDocument()
    })
  })
})
