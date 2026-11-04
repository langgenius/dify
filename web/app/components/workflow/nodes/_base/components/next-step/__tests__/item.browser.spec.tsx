import type { CommonNodeType } from '@/app/components/workflow/types'
import ReactFlow, { useNodes } from 'reactflow'
import { page, userEvent } from 'vite-plus/test/browser'
import { createNode } from '@/app/components/workflow/__tests__/fixtures'
import { renderWorkflowBrowserComponent as render } from '@/app/components/workflow/__tests__/workflow-browser-test-env'
import { BlockEnum } from '@/app/components/workflow/types'
import Item from '../item'

const unexpectedFetch = vi.fn<typeof fetch>(() => new Promise(() => {}))
beforeEach(() => vi.stubGlobal('fetch', unexpectedFetch))
afterEach(() => {
  vi.unstubAllGlobals()
  expect(unexpectedFetch).not.toHaveBeenCalled()
})

function SelectedNodes() {
  const nodes = useNodes<CommonNodeType>()
  return (
    <output aria-label="Selected nodes">
      {nodes
        .filter((node) => node.data.selected)
        .map((node) => node.id)
        .join(',')}
    </output>
  )
}

// Real CSS and sequential focus catch controls skipped by Tab or hidden when menu focus returns.
it('reveals next-step actions to keyboard users and keeps restored focus visible', async () => {
  await render(
    <>
      <button type="button">Before next step</button>
      <div style={{ width: 400, marginTop: 80 }}>
        <Item
          nodeId="next-node"
          sourceHandle="source"
          data={{ type: BlockEnum.Code, title: 'Transform', desc: '' }}
        />
      </div>
      <div style={{ width: 800, height: 400 }}>
        <ReactFlow
          defaultNodes={[
            createNode({ id: 'previous-node', selected: true, data: { selected: true } }),
            createNode({
              id: 'next-node',
              position: { x: 400, y: 0 },
              data: { title: 'Transform' },
            }),
          ]}
        />
      </div>
      <SelectedNodes />
    </>,
  )
  await page.getByRole('button', { name: 'Before next step' }).click()
  await userEvent.keyboard('{Tab}')
  const jump = page.getByRole('button', { name: 'workflow.common.jumpToNode' })
  await expect.element(jump).toHaveFocus()
  expect(jump.element().checkVisibility({ opacityProperty: true })).toBe(true)
  await userEvent.keyboard('{Enter}')
  await expect
    .element(page.getByRole('status', { name: 'Selected nodes' }))
    .toHaveTextContent('next-node')

  expect(page.getByRole('status', { name: 'Selected nodes' }).element().textContent).toBe(
    'next-node',
  )

  await userEvent.keyboard('{Tab}')
  const more = page.getByRole('button', { name: 'workflow.common.moreActions' })
  await expect.element(more).toHaveFocus()
  expect(more.element().checkVisibility({ opacityProperty: true })).toBe(true)
  await userEvent.keyboard('{Enter}')
  await expect.element(page.getByRole('menu')).toBeVisible()
  await userEvent.keyboard('{Escape}')

  await expect.element(page.getByRole('menu')).not.toBeInTheDocument()
  await expect.element(more).toHaveFocus()
  expect(more.element().checkVisibility({ opacityProperty: true })).toBe(true)
})
