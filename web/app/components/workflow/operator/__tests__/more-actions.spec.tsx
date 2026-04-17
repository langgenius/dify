import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { act } from 'react'
import MoreActions from '../more-actions'

const mockToPng = vi.fn()
const mockToJpeg = vi.fn()
const mockToSvg = vi.fn()
const mockDownloadUrl = vi.fn()
const mockSetViewport = vi.fn()
const mockGetNodesReadOnly = vi.fn()
const {
  mockAppStoreState,
  mockWorkflowState,
} = vi.hoisted(() => ({
  mockAppStoreState: {
    appSidebarExpand: 'collapse',
  },
  mockWorkflowState: {
    knowledgeName: '',
    appName: 'Demo App',
    maximizeCanvas: false,
  },
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { ns?: string }) => options?.ns ? `${options.ns}.${key}` : key,
  }),
}))

vi.mock('@/app/components/base/ui/dropdown-menu', async () => {
  const React = await import('react')
  const DropdownMenuContext = React.createContext<{ open: boolean, setOpen: (open: boolean) => void } | null>(null)

  const useDropdownMenuContext = () => {
    const context = React.use(DropdownMenuContext)
    if (!context)
      throw new Error('DropdownMenu components must be wrapped in DropdownMenu')
    return context
  }

  return {
    DropdownMenu: ({ children, open, onOpenChange }: { children: React.ReactNode, open: boolean, onOpenChange?: (open: boolean) => void }) => (
      <DropdownMenuContext value={{ open, setOpen: onOpenChange ?? vi.fn() }}>
        <div>{children}</div>
      </DropdownMenuContext>
    ),
    DropdownMenuTrigger: ({ children, className }: { children: React.ReactNode, className?: string }) => {
      const { open, setOpen } = useDropdownMenuContext()
      return (
        <button type="button" className={className} onClick={() => setOpen(!open)}>
          {children}
        </button>
      )
    },
    DropdownMenuContent: ({ children }: { children: React.ReactNode }) => {
      const { open } = useDropdownMenuContext()
      return open ? <div>{children}</div> : null
    },
    DropdownMenuItem: ({
      children,
      onClick,
      className,
    }: {
      children: React.ReactNode
      onClick?: React.MouseEventHandler<HTMLButtonElement>
      className?: string
    }) => {
      const { setOpen } = useDropdownMenuContext()
      return (
        <button
          type="button"
          className={className}
          onClick={(event) => {
            onClick?.(event)
            setOpen(false)
          }}
        >
          {children}
        </button>
      )
    },
    DropdownMenuSeparator: ({ className }: { className?: string }) => <div className={className} data-testid="dropdown-separator" />,
  }
})

vi.mock('html-to-image', () => ({
  toPng: (...args: unknown[]) => mockToPng(...args),
  toJpeg: (...args: unknown[]) => mockToJpeg(...args),
  toSvg: (...args: unknown[]) => mockToSvg(...args),
}))

vi.mock('reactflow', () => ({
  getNodesBounds: () => ({ x: 0, y: 0, width: 240, height: 120 }),
  useReactFlow: () => ({
    getNodes: () => [{ id: 'node-1' }],
    getViewport: () => ({ x: 0, y: 0, zoom: 1 }),
    setViewport: mockSetViewport,
  }),
}))

vi.mock('@/app/components/app/store', () => ({
  useStore: (selector: (state: typeof mockAppStoreState) => unknown) => selector(mockAppStoreState),
}))

vi.mock('@/app/components/workflow/store', () => ({
  useStore: (selector: (state: typeof mockWorkflowState) => unknown) => selector(mockWorkflowState),
}))

vi.mock('@/app/components/workflow/hooks', () => ({
  useNodesReadOnly: () => ({
    getNodesReadOnly: mockGetNodesReadOnly,
  }),
}))

vi.mock('@/utils/download', () => ({
  downloadUrl: (...args: unknown[]) => mockDownloadUrl(...args),
}))

vi.mock('../tip-popup', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

vi.mock('@/app/components/base/image-uploader/image-preview', () => ({
  default: ({ title, onCancel }: { title: string, onCancel: () => void }) => (
    <div data-testid="image-preview">
      <span>{title}</span>
      <button type="button" onClick={onCancel}>close-preview</button>
    </div>
  ),
}))

describe('MoreActions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
    mockGetNodesReadOnly.mockReturnValue(false)
    mockToPng.mockResolvedValue('data:image/png;base64,current')
    mockToJpeg.mockResolvedValue('data:image/jpeg;base64,current')
    mockToSvg.mockResolvedValue('data:image/svg+xml;base64,current')
    mockAppStoreState.appSidebarExpand = 'collapse'
    mockWorkflowState.knowledgeName = ''
    mockWorkflowState.appName = 'Demo App'
    mockWorkflowState.maximizeCanvas = false

    document.body.innerHTML = ''
    const viewport = document.createElement('div')
    viewport.className = 'react-flow__viewport'
    document.body.appendChild(viewport)
  })

  it('opens the menu and exports the current view as png', async () => {
    const user = userEvent.setup()

    render(<MoreActions />)

    await user.click(screen.getByRole('button'))
    await user.click(screen.getAllByText('workflow.common.exportPNG')[0]!)

    await waitFor(() => {
      expect(mockToPng).toHaveBeenCalledTimes(1)
    })
    expect(mockDownloadUrl).toHaveBeenCalledWith({
      url: 'data:image/png;base64,current',
      fileName: 'Demo App.png',
    })
  })

  it('does not open the menu when the workflow is read only', async () => {
    const user = userEvent.setup()
    mockGetNodesReadOnly.mockReturnValue(true)

    render(<MoreActions />)

    await user.click(screen.getByRole('button'))

    expect(screen.queryByText('workflow.common.exportImage')).not.toBeInTheDocument()
  })

  it('shows a preview when exporting the whole workflow', async () => {
    vi.useFakeTimers()

    render(<MoreActions />)

    fireEvent.click(screen.getByRole('button'))
    fireEvent.click(screen.getAllByText('workflow.common.exportPNG')[1]!)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })

    expect(screen.getByTestId('image-preview')).toHaveTextContent('Demo App-whole-workflow.png')
    await act(async () => {
      await vi.runAllTimersAsync()
    })
    expect(mockSetViewport).toHaveBeenCalledTimes(2)
    expect(mockDownloadUrl).toHaveBeenCalledWith({
      url: 'data:image/png;base64,current',
      fileName: 'Demo App-whole-workflow.png',
    })
  })

  it.each([
    ['workflow.common.exportJPEG', mockToJpeg, 'Demo App.jpeg'],
    ['workflow.common.exportSVG', mockToSvg, 'Demo App.svg'],
  ])('exports the current view with %s', async (label, exporter, fileName) => {
    const user = userEvent.setup()

    render(<MoreActions />)

    await user.click(screen.getByRole('button'))
    await user.click(screen.getAllByText(label)[0]!)

    await waitFor(() => {
      expect(exporter).toHaveBeenCalledTimes(1)
    })
    expect(mockDownloadUrl).toHaveBeenCalledWith({
      url: expect.any(String),
      fileName,
    })
  })

  it('exports the whole workflow as svg when the canvas is maximized', async () => {
    vi.useFakeTimers()
    mockWorkflowState.maximizeCanvas = true

    render(<MoreActions />)

    fireEvent.click(screen.getByRole('button'))
    fireEvent.click(screen.getAllByText('workflow.common.exportSVG')[1]!)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })

    expect(mockToSvg).toHaveBeenCalledTimes(1)
    await act(async () => {
      await vi.runAllTimersAsync()
    })
    expect(mockSetViewport).toHaveBeenCalledTimes(2)
    expect(screen.getByTestId('image-preview')).toHaveTextContent('Demo App-whole-workflow.svg')
  })

  it('returns early when there is no app or knowledge name', async () => {
    const user = userEvent.setup()
    mockWorkflowState.appName = ''
    mockWorkflowState.knowledgeName = ''

    render(<MoreActions />)

    await user.click(screen.getByRole('button'))
    await user.click(screen.getAllByText('workflow.common.exportPNG')[0]!)

    expect(mockToPng).not.toHaveBeenCalled()
    expect(mockDownloadUrl).not.toHaveBeenCalled()
  })

  it('returns early when the viewport element is missing', async () => {
    const user = userEvent.setup()
    document.querySelector('.react-flow__viewport')?.remove()

    render(<MoreActions />)

    await user.click(screen.getByRole('button'))
    await user.click(screen.getAllByText('workflow.common.exportPNG')[0]!)

    expect(mockToPng).not.toHaveBeenCalled()
    expect(mockDownloadUrl).not.toHaveBeenCalled()
  })

  it('returns early when the workflow becomes read only before exporting', async () => {
    const user = userEvent.setup()

    render(<MoreActions />)

    await user.click(screen.getByRole('button'))
    mockGetNodesReadOnly.mockReturnValue(true)
    await user.click(screen.getAllByText('workflow.common.exportJPEG')[0]!)

    expect(mockToJpeg).not.toHaveBeenCalled()
    expect(mockDownloadUrl).not.toHaveBeenCalled()
  })

  it('logs export failures and lets the preview close', async () => {
    const user = userEvent.setup()
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockToJpeg.mockRejectedValueOnce(new Error('boom'))

    render(<MoreActions />)

    await user.click(screen.getByRole('button'))
    await user.click(screen.getAllByText('workflow.common.exportJPEG')[0]!)

    await waitFor(() => {
      expect(consoleErrorSpy).toHaveBeenCalledWith('Export image failed:', expect.any(Error))
    })
    expect(screen.queryByTestId('image-preview')).not.toBeInTheDocument()

    mockToPng.mockResolvedValueOnce('data:image/png;base64,current')
    fireEvent.click(screen.getByRole('button'))
    fireEvent.click(screen.getAllByText('workflow.common.exportPNG')[1]!)
    await waitFor(() => {
      expect(screen.getByTestId('image-preview')).toBeInTheDocument()
    })
    await user.click(screen.getByText('close-preview'))
    expect(screen.queryByTestId('image-preview')).not.toBeInTheDocument()

    consoleErrorSpy.mockRestore()
  })
})
