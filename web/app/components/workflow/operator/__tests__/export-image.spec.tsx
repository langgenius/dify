import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { act } from 'react'
import { ExportImage } from '../export-image'

const mockToPng = vi.fn()
const mockToJpeg = vi.fn()
const mockToSvg = vi.fn()
const mockDownloadUrl = vi.fn()
const mockSetViewport = vi.fn()
const mockGetNodesReadOnly = vi.fn()
const { mockWorkflowState } = vi.hoisted(() => ({
  mockWorkflowState: {
    knowledgeName: '',
    appName: 'Demo App',
  },
}))

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

vi.mock('@/app/components/workflow/store', () => ({
  useStore: (selector: (state: typeof mockWorkflowState) => unknown) => selector(mockWorkflowState),
}))

vi.mock('../../hooks/use-workflow', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../hooks/use-workflow')>()

  return {
    ...actual,
    useNodesReadOnly: () => ({
      getNodesReadOnly: mockGetNodesReadOnly,
    }),
  }
})

vi.mock('@/utils/download', () => ({
  downloadUrl: (...args: unknown[]) => mockDownloadUrl(...args),
}))

vi.mock('@/app/components/base/image-uploader/image-preview', () => ({
  default: ({ title, onCancel }: { title: string; onCancel: () => void }) => (
    <div data-testid="image-preview">
      <span>{title}</span>
      <button type="button" onClick={onCancel}>
        close-preview
      </button>
    </div>
  ),
}))

describe('ExportImage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
    mockGetNodesReadOnly.mockReturnValue(false)
    mockToPng.mockResolvedValue('data:image/png;base64,current')
    mockToJpeg.mockResolvedValue('data:image/jpeg;base64,current')
    mockToSvg.mockResolvedValue('data:image/svg+xml;base64,current')
    mockWorkflowState.knowledgeName = ''
    mockWorkflowState.appName = 'Demo App'

    document.body.innerHTML = ''
    const viewport = document.createElement('div')
    viewport.className = 'react-flow__viewport'
    document.body.appendChild(viewport)
  })

  it('opens the menu and exports the current view as png', async () => {
    const user = userEvent.setup()

    render(<ExportImage />)

    await user.click(screen.getByRole('button', { name: 'workflow.common.exportImage' }))
    const menu = screen.getByRole('menu', { name: 'workflow.common.exportImage' })
    expect(within(menu).getAllByRole('menuitem')).toHaveLength(6)
    expect(
      within(menu).getByRole('group', { name: 'workflow.common.currentView' }),
    ).toBeInTheDocument()
    expect(
      within(menu).getByRole('group', { name: 'workflow.common.currentWorkflow' }),
    ).toBeInTheDocument()
    expect(within(menu).queryByText('workflow.common.exportImage')).not.toBeInTheDocument()
    await user.click(
      within(within(menu).getByRole('group', { name: 'workflow.common.currentView' })).getByRole(
        'menuitem',
        { name: 'workflow.common.exportPNG' },
      ),
    )

    await waitFor(() => {
      expect(mockToPng).toHaveBeenCalledTimes(1)
    })
    expect(mockDownloadUrl).toHaveBeenCalledWith({
      url: 'data:image/png;base64,current',
      fileName: 'Demo App.png',
    })
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
  })

  it('does not open the menu when the workflow is read only', async () => {
    const user = userEvent.setup()
    mockGetNodesReadOnly.mockReturnValue(true)

    render(<ExportImage />)

    const trigger = screen.getByRole('button', { name: 'workflow.common.exportImage' })
    expect(trigger).toHaveAttribute('aria-disabled', 'true')

    await user.tab()
    expect(trigger).toHaveFocus()
    await user.keyboard('{Enter}')

    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('shows a preview when exporting the whole workflow', async () => {
    vi.useFakeTimers()

    render(<ExportImage />)

    fireEvent.click(screen.getByRole('button', { name: 'workflow.common.exportImage' }))
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

    render(<ExportImage />)

    await user.click(screen.getByRole('button', { name: 'workflow.common.exportImage' }))
    await user.click(screen.getAllByText(label)[0]!)

    await waitFor(() => {
      expect(exporter).toHaveBeenCalledTimes(1)
    })
    expect(mockDownloadUrl).toHaveBeenCalledWith({
      url: expect.any(String),
      fileName,
    })
  })

  it('exports the whole workflow as svg', async () => {
    vi.useFakeTimers()

    render(<ExportImage />)

    fireEvent.click(screen.getByRole('button', { name: 'workflow.common.exportImage' }))
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

    render(<ExportImage />)

    await user.click(screen.getByRole('button', { name: 'workflow.common.exportImage' }))
    await user.click(screen.getAllByText('workflow.common.exportPNG')[0]!)

    expect(mockToPng).not.toHaveBeenCalled()
    expect(mockDownloadUrl).not.toHaveBeenCalled()
  })

  it('returns early when the viewport element is missing', async () => {
    const user = userEvent.setup()
    document.querySelector('.react-flow__viewport')?.remove()

    render(<ExportImage />)

    await user.click(screen.getByRole('button', { name: 'workflow.common.exportImage' }))
    await user.click(screen.getAllByText('workflow.common.exportPNG')[0]!)

    expect(mockToPng).not.toHaveBeenCalled()
    expect(mockDownloadUrl).not.toHaveBeenCalled()
  })

  it('returns early when the workflow becomes read only before exporting', async () => {
    const user = userEvent.setup()

    render(<ExportImage />)

    await user.click(screen.getByRole('button', { name: 'workflow.common.exportImage' }))
    mockGetNodesReadOnly.mockReturnValue(true)
    await user.click(screen.getAllByText('workflow.common.exportJPEG')[0]!)

    expect(mockToJpeg).not.toHaveBeenCalled()
    expect(mockDownloadUrl).not.toHaveBeenCalled()
  })

  it('logs export failures and lets the preview close', async () => {
    const user = userEvent.setup()
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockToJpeg.mockRejectedValueOnce(new Error('boom'))

    render(<ExportImage />)

    await user.click(screen.getByRole('button', { name: 'workflow.common.exportImage' }))
    await user.click(screen.getAllByText('workflow.common.exportJPEG')[0]!)

    await waitFor(() => {
      expect(consoleErrorSpy).toHaveBeenCalledWith('Export image failed:', expect.any(Error))
    })
    expect(screen.queryByTestId('image-preview')).not.toBeInTheDocument()

    mockToPng.mockResolvedValueOnce('data:image/png;base64,current')
    fireEvent.click(screen.getByRole('button', { name: 'workflow.common.exportImage' }))
    fireEvent.click(screen.getAllByText('workflow.common.exportPNG')[1]!)
    await waitFor(() => {
      expect(screen.getByTestId('image-preview')).toBeInTheDocument()
    })
    await user.click(screen.getByText('close-preview'))
    expect(screen.queryByTestId('image-preview')).not.toBeInTheDocument()

    consoleErrorSpy.mockRestore()
  })
})
