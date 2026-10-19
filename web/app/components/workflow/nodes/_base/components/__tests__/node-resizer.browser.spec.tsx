import type { ReactNode } from 'react'
import type { ResizeParamsWithDirection } from 'reactflow'
import ReactFlow from 'reactflow'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { WorkflowContext } from '@/app/components/workflow/context'
import NoteNode from '@/app/components/workflow/note-node'
import { NoteTheme } from '@/app/components/workflow/note-node/types'
import { createWorkflowStore } from '@/app/components/workflow/store/workflow'
import { BlockEnum } from '@/app/components/workflow/types'
import 'reactflow/dist/style.css'

vi.mock('../../../../hooks/use-workflow', () => ({
  useNodesReadOnly: () => ({ nodesReadOnly: false }),
}))

// Editing and persistence are independent of the Note's rendered resize affordance.
vi.mock('../../../../note-node/note-editor', () => ({
  NoteEditorContextProvider: ({ children }: { children: ReactNode }) => children,
  NoteEditor: () => <span>Note content</span>,
  NoteEditorToolbar: () => null,
}))

vi.mock('../../../../note-node/hooks', () => ({
  useNote: () => ({
    handleThemeChange: vi.fn(),
    handleEditorChange: vi.fn(),
    handleShowAuthorChange: vi.fn(),
  }),
}))

vi.mock('../../../../hooks/use-node-data-update', () => ({
  useNodeDataUpdate: () => ({ handleNodeDataUpdateWithSyncDraft: vi.fn() }),
}))

vi.mock('../../../../hooks/use-nodes-interactions', async () => {
  const { useStoreApi } = await import('reactflow')
  return {
    useNodesInteractions: () => {
      const store = useStoreApi()
      return {
        handleNodeResize: (id: string, { width, height }: ResizeParamsWithDirection) => {
          const { getNodes, setNodes } = store.getState()
          setNodes(
            getNodes().map((node) =>
              node.id === id
                ? {
                    ...node,
                    width,
                    height,
                    data: { ...node.data, width, height },
                  }
                : node,
            ),
          )
        },
      }
    },
  }
})

const noteNodeTypes = { note: NoteNode }

it('hides an unselected Note resize handle from pointer targeting until hover or keyboard focus, then resizes by dragging', async () => {
  // Browser-owned: transparent descendants still participate in CSS hit testing,
  // native Tab focus must reveal the real Note's resize affordance, and D3 drag needs real pointer events.
  await page.viewport(1000, 800)
  const store = createWorkflowStore({})
  const screen = await render(
    <WorkflowContext value={store}>
      <button type="button">Before canvas</button>
      <div role="group" aria-label="Canvas" style={{ width: 800, height: 600 }}>
        <ReactFlow
          defaultNodes={[
            {
              id: 'note',
              type: 'note',
              ariaLabel: 'Note',
              position: { x: 100, y: 100 },
              data: {
                title: 'Note',
                desc: '',
                type: BlockEnum.Code,
                text: '',
                theme: NoteTheme.blue,
                author: 'Alice',
                showAuthor: false,
                selected: false,
                width: 300,
                height: 200,
              },
            },
          ]}
          nodeTypes={noteNodeTypes}
        />
      </div>
    </WorkflowContext>,
  )
  const node = screen.getByRole('button', { name: 'Note', exact: true })
  const control = screen.getByRole('button', { name: 'common.resize.node' })
  const beforeCanvas = screen.getByRole('button', { name: 'Before canvas' })
  await expect.element(node).toBeVisible()
  await beforeCanvas.click()
  expect(control.element().checkVisibility({ checkOpacity: true })).toBe(false)
  const rect = control.element().getBoundingClientRect()
  const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
  expect(control.element().contains(hit)).toBe(false)

  await node.hover()
  expect(control.element().checkVisibility({ checkOpacity: true })).toBe(true)
  const hoveredHit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
  expect(control.element().contains(hoveredHit)).toBe(true)
  await beforeCanvas.click()
  expect(control.element().checkVisibility({ checkOpacity: true })).toBe(false)
  await userEvent.tab()
  await userEvent.tab()
  await expect.element(control).toHaveFocus()
  expect(control.element().checkVisibility({ checkOpacity: true })).toBe(true)

  await userEvent.dragAndDrop(control, screen.getByRole('group', { name: 'Canvas', exact: true }), {
    targetPosition: { x: 550, y: 450 },
  })
  await expect.poll(() => node.element().getBoundingClientRect().width).toBeGreaterThan(300)
  expect(node.element().getBoundingClientRect().height).toBeGreaterThan(200)
})
