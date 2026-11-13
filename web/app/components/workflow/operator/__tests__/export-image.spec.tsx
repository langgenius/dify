import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { act, useEffect } from 'react'
import { useReactFlow } from 'reactflow'
import { createNode } from '@/app/components/workflow/__tests__/fixtures'
import { renderWorkflowFlowComponent as render } from '@/app/components/workflow/__tests__/workflow-test-env'
import { createConsoleQueryClient, seedAppDetail } from '@/test/console/query-data'
import { createAppDetailFixture } from '@/test/fixtures/app'
import { ExportImage } from '../export-image'

const mockToPng = vi.fn()
const mockToJpeg = vi.fn()
const mockToSvg = vi.fn()
const mockDownloadUrl = vi.fn()
const { mockWorkflowState } = vi.hoisted(() => ({
  mockWorkflowState: {
    appName: 'Demo App',
  },
}))

vi.mock('html-to-image', () => ({
  toPng: (...args: unknown[]) => mockToPng(...args),
  toJpeg: (...args: unknown[]) => mockToJpeg(...args),
  toSvg: (...args: unknown[]) => mockToSvg(...args),
}))

vi.mock('@/utils/download', () => ({
  downloadUrl: (...args: unknown[]) => mockDownloadUrl(...args),
}))

function createExportQueryClient() {
  const queryClient = createConsoleQueryClient()
  seedAppDetail(
    queryClient,
    createAppDetailFixture({ id: 'app-1', mode: 'workflow', name: mockWorkflowState.appName }),
  )
  return queryClient
}

const originalViewport = { x: 137, y: -83, zoom: 0.65 }
const fittedViewport = { x: -40, y: 68, zoom: 0.8 }

const nodes = [
  createNode({ id: 'left', position: { x: 100, y: 80 }, width: 400, height: 200 }),
  createNode({ id: 'right', position: { x: 900, y: 500 }, width: 300, height: 150 }),
]

type Flow = ReturnType<typeof useReactFlow>

function ReactFlowProbe({ onReady }: { onReady: (flow: Flow) => void }) {
  const flow = useReactFlow()
  useEffect(() => onReady(flow), [flow, onReady])
  return null
}

function renderExport(options: Parameters<typeof render>[1] = {}) {
  let flow: Flow | undefined
  const onReady = (instance: Flow) => {
    flow = instance
  }
  const rendered = render(
    <>
      <ExportImage />
      <ReactFlowProbe onReady={onReady} />
    </>,
    {
      nodes,
      reactFlowProps: { fitView: false, defaultViewport: originalViewport },
      resource: { kind: 'app', appId: 'app-1', mode: 'workflow' },
      queryClient: createExportQueryClient(),
      ...options,
    },
  )

  if (!flow) throw new Error('ReactFlow probe did not mount')
  return { ...rendered, flow }
}

describe('ExportImage', () => {
  beforeEach(() => {
    mockToPng.mockReset().mockResolvedValue('data:image/png;base64,current')
    mockToJpeg.mockReset().mockResolvedValue('data:image/jpeg;base64,current')
    mockToSvg.mockReset().mockResolvedValue('data:image/svg+xml;base64,current')
    mockDownloadUrl.mockReset()
    mockWorkflowState.appName = 'Demo App'
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(960)
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(720)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('opens the menu and exports the current view as png', async () => {
    const user = userEvent.setup()

    renderExport()

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

    await waitFor(() =>
      expect(mockDownloadUrl).toHaveBeenCalledWith({
        url: 'data:image/png;base64,current',
        fileName: 'Demo App.png',
      }),
    )
    expect(mockToPng).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('does not open the menu when the workflow is read only', async () => {
    const user = userEvent.setup()
    renderExport({ initialStoreState: { canvasReadOnly: true } })

    const trigger = screen.getByRole('button', { name: 'workflow.common.exportImage' })
    expect(trigger).toHaveAttribute('aria-disabled', 'true')

    trigger.focus()
    expect(trigger).toHaveFocus()
    await user.keyboard('{Enter}')

    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('shows a preview when exporting the whole workflow', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    const { flow } = renderExport()
    let captureViewport: ReturnType<Flow['getViewport']> | undefined
    mockToPng.mockImplementationOnce(async () => {
      captureViewport = flow.getViewport()
      return 'data:image/png;base64,current'
    })

    await user.click(screen.getByRole('button', { name: 'workflow.common.exportImage' }))
    await user.click(
      within(screen.getByRole('group', { name: 'workflow.common.currentWorkflow' })).getByRole(
        'menuitem',
        { name: 'workflow.common.exportPNG' },
      ),
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })

    expect(captureViewport).toEqual(fittedViewport)
    expect(mockToPng).toHaveBeenCalledWith(
      expect.any(HTMLElement),
      expect.objectContaining({
        backgroundColor: '#1a1a1a',
        height: 670,
        pixelRatio: 2,
        style: expect.objectContaining({
          height: '670px',
          transform: 'translate(-50px, -30px)',
          width: '1200px',
        }),
        width: 1200,
      }),
    )
    expect(flow.getViewport()).toEqual(originalViewport)
    expect(screen.getByRole('dialog', { name: 'Demo App-whole-workflow.png' })).toBeInTheDocument()
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

    renderExport()

    await user.click(screen.getByRole('button', { name: 'workflow.common.exportImage' }))
    await user.click(
      within(screen.getByRole('group', { name: 'workflow.common.currentView' })).getByRole(
        'menuitem',
        { name: label },
      ),
    )

    await waitFor(() =>
      expect(mockDownloadUrl).toHaveBeenCalledWith({
        url: expect.any(String),
        fileName,
      }),
    )
    expect(exporter).toHaveBeenCalledTimes(1)
  })

  it('exports the whole workflow as svg', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    const { flow } = renderExport()
    let captureViewport: ReturnType<Flow['getViewport']> | undefined
    mockToSvg.mockImplementationOnce(async () => {
      captureViewport = flow.getViewport()
      return 'data:image/svg+xml;base64,current'
    })

    await user.click(screen.getByRole('button', { name: 'workflow.common.exportImage' }))
    await user.click(
      within(screen.getByRole('group', { name: 'workflow.common.currentWorkflow' })).getByRole(
        'menuitem',
        { name: 'workflow.common.exportSVG' },
      ),
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })

    expect(mockToSvg).toHaveBeenCalledTimes(1)
    expect(captureViewport).toEqual(fittedViewport)
    expect(flow.getViewport()).toEqual(originalViewport)
    expect(screen.getByRole('dialog', { name: 'Demo App-whole-workflow.svg' })).toBeInTheDocument()
  })

  it('uses the refreshed App name when exporting without restarting the editor', async () => {
    const user = userEvent.setup()
    const queryClient = createExportQueryClient()
    renderExport({ queryClient })
    await act(async () => {
      seedAppDetail(
        queryClient,
        createAppDetailFixture({ id: 'app-1', mode: 'workflow', name: 'Renamed App' }),
      )
    })
    await user.click(screen.getByRole('button', { name: 'workflow.common.exportImage' }))
    const group = screen.getByRole('group', { name: 'workflow.common.currentView' })
    await user.click(within(group).getByRole('menuitem', { name: 'workflow.common.exportPNG' }))
    await waitFor(() =>
      expect(mockDownloadUrl).toHaveBeenCalledWith({
        url: 'data:image/png;base64,current',
        fileName: 'Renamed App.png',
      }),
    )
  })

  it('returns early when there is no app or knowledge name', async () => {
    const user = userEvent.setup()
    mockWorkflowState.appName = ''

    renderExport()

    await user.click(screen.getByRole('button', { name: 'workflow.common.exportImage' }))
    await user.click(
      within(screen.getByRole('group', { name: 'workflow.common.currentView' })).getByRole(
        'menuitem',
        { name: 'workflow.common.exportPNG' },
      ),
    )

    expect(mockToPng).not.toHaveBeenCalled()
    expect(mockDownloadUrl).not.toHaveBeenCalled()
  })

  it('restores the viewport when rendering the whole workflow fails', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { flow } = renderExport()
    let captureViewport: ReturnType<Flow['getViewport']> | undefined
    mockToPng.mockImplementationOnce(async () => {
      captureViewport = flow.getViewport()
      throw new Error('capture failed')
    })
    await user.click(screen.getByRole('button', { name: 'workflow.common.exportImage' }))
    await user.click(
      within(screen.getByRole('group', { name: 'workflow.common.currentWorkflow' })).getByRole(
        'menuitem',
        { name: 'workflow.common.exportPNG' },
      ),
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })

    expect(mockToPng).toHaveBeenCalledTimes(1)
    expect(captureViewport).toEqual(fittedViewport)
    expect(flow.getViewport()).toEqual(originalViewport)
    expect(mockDownloadUrl).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('logs export failures and lets the preview close', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockToJpeg.mockRejectedValueOnce(new Error('boom'))

    renderExport()

    await user.click(screen.getByRole('button', { name: 'workflow.common.exportImage' }))
    await user.click(
      within(screen.getByRole('group', { name: 'workflow.common.currentView' })).getByRole(
        'menuitem',
        { name: 'workflow.common.exportJPEG' },
      ),
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(consoleErrorSpy).toHaveBeenCalledWith('Export image failed:', expect.any(Error))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    mockToPng.mockResolvedValueOnce('data:image/png;base64,current')
    await user.click(screen.getByRole('button', { name: 'workflow.common.exportImage' }))
    await user.click(
      within(screen.getByRole('group', { name: 'workflow.common.currentWorkflow' })).getByRole(
        'menuitem',
        { name: 'workflow.common.exportPNG' },
      ),
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })
    expect(screen.getByRole('dialog', { name: 'Demo App-whole-workflow.png' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    consoleErrorSpy.mockRestore()
  })
})
