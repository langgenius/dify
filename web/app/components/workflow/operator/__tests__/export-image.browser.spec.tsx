import type { NodeProps } from 'reactflow'
import ReactFlow, { Handle, Position } from 'reactflow'
import { page } from 'vite-plus/test/browser'
import { createNode } from '@/app/components/workflow/__tests__/fixtures'
import { renderWorkflowBrowserComponent as render } from '@/app/components/workflow/__tests__/workflow-browser-test-env'
import { createConsoleQueryClient, seedAppDetail } from '@/test/console/query-data'
import { createAppDetailFixture } from '@/test/fixtures/app'
import { ExportImage } from '../export-image'
import 'reactflow/dist/style.css'

const mockDownloadBlob = vi.fn()

// boundary: a real download leaves the page; the downloaded Blob is the export contract.
vi.mock('@/utils/download', () => ({
  downloadBlob: (...args: unknown[]) => mockDownloadBlob(...args),
}))

// WebKit refuses to load any URL longer than 2^26 characters, so a larger export never renders in Safari.
const WEBKIT_MAX_URL_LENGTH = 2 ** 26

function WorkflowNode({ data }: NodeProps) {
  return (
    <div className="w-60 rounded-2xl border border-components-panel-border bg-workflow-block-bg shadow-xs">
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
      <div className="flex items-center gap-2 px-3 pt-3 pb-2">
        <span className="i-ri-robot-2-line size-4 text-text-accent" />
        <span className="truncate system-sm-semibold text-text-primary">{data.title}</span>
      </div>
      {['Input', 'Model', 'Output'].map((label) => (
        <div
          key={label}
          className="mx-3 mb-1 flex items-center justify-between rounded-md bg-workflow-block-parma-bg px-1.5 py-1"
        >
          <span className="system-xs-medium text-text-tertiary">{label}</span>
          <span className="truncate system-xs-regular text-text-secondary">
            Summarize the quarterly report
          </span>
        </div>
      ))}
    </div>
  )
}

const nodeTypes = { workflow: WorkflowNode }

async function renderWorkflow(nodeCount: number) {
  const nodes = Array.from({ length: nodeCount }, (_, index) =>
    createNode({
      id: `node-${index}`,
      type: 'workflow',
      position: { x: (index % 12) * 300, y: Math.floor(index / 12) * 200 },
      data: { title: `Node ${index}` },
    }),
  )
  // Workflow edges reference design tokens from their inline style, as the production edge does.
  const edges = nodes.slice(1).map((node, index) => ({
    id: `edge-${index}`,
    source: nodes[index]!.id,
    target: node.id,
    type: 'straight',
    style: { stroke: 'var(--color-workflow-link-line-handle)', strokeWidth: 6 },
  }))

  await page.viewport(1280, 800)
  const queryClient = createConsoleQueryClient()
  seedAppDetail(
    queryClient,
    createAppDetailFixture({ id: 'app-1', mode: 'workflow', name: 'Demo App' }),
  )
  return render(
    <>
      <ExportImage />
      <div style={{ width: 1200, height: 700 }}>
        <ReactFlow defaultNodes={nodes} defaultEdges={edges} nodeTypes={nodeTypes} />
      </div>
    </>,
    { queryClient, resource: { kind: 'app', appId: 'app-1', mode: 'workflow' } },
  )
}

async function exportCurrentViewAsSvg(screen: Awaited<ReturnType<typeof renderWorkflow>>) {
  const download = new Promise<{ data: Blob; fileName: string }>((resolve) => {
    mockDownloadBlob.mockImplementationOnce(resolve)
  })
  await screen.getByRole('button', { name: 'workflow.common.exportImage' }).click()
  await screen
    .getByRole('group', { name: 'workflow.common.currentView' })
    .getByRole('menuitem', { name: 'workflow.common.exportSVG' })
    .click()
  const { data, fileName } = await download
  return { svg: await data.text(), type: data.type, fileName }
}

// Rasterize the exported SVG the way html-to-image does for PNG and JPEG, then read the first edge.
async function readFirstEdgeColor(svg: string) {
  const viewport = document.querySelector('.react-flow__viewport')!.getBoundingClientRect()
  const edge = document.querySelector('.react-flow__edge-path')!.getBoundingClientRect()
  const image = new Image()
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  await image.decode()
  const canvas = document.createElement('canvas')
  canvas.width = image.naturalWidth
  canvas.height = image.naturalHeight
  const context = canvas.getContext('2d')!
  context.drawImage(image, 0, 0)
  const x = Math.round(edge.left + edge.width / 2 - viewport.left)
  const y = Math.round(edge.top + edge.height / 2 - viewport.top)
  const [red, green, blue] = context.getImageData(x, y, 1, 1).data
  return `rgb(${red}, ${green}, ${blue})`
}

const liveEdgeColor = () =>
  getComputedStyle(document.querySelector('.react-flow__edge-path')!).stroke

describe('ExportImage in a browser', () => {
  it('exports a large workflow that WebKit can load, edges included', async () => {
    const screen = await renderWorkflow(70)

    const { svg, type, fileName } = await exportCurrentViewAsSvg(screen)

    expect(fileName).toBe('Demo App.svg')
    expect(type).toBe('image/svg+xml')
    expect(svg).toContain('Summarize the quarterly report')
    expect(encodeURIComponent(svg).length).toBeLessThan(WEBKIT_MAX_URL_LENGTH)
    expect(await readFirstEdgeColor(svg)).toBe(liveEdgeColor())
  })

  it('uses the current theme colors when exporting again', async () => {
    const screen = await renderWorkflow(2)
    const light = await exportCurrentViewAsSvg(screen)
    const lightEdge = liveEdgeColor()

    document.documentElement.dataset.theme = 'dark'
    onTestFinished(() => {
      document.documentElement.dataset.theme = 'light'
    })
    const dark = await exportCurrentViewAsSvg(screen)

    expect(liveEdgeColor()).not.toBe(lightEdge)
    expect(await readFirstEdgeColor(light.svg)).toBe(lightEdge)
    expect(await readFirstEdgeColor(dark.svg)).toBe(liveEdgeColor())
  })
})
