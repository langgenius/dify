import type { CommonNodeType } from '@/app/components/workflow/types'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { BlockEnum } from '@/app/components/workflow/types'
import Item from '../item'

const { handleNodeSelect } = vi.hoisted(() => ({ handleNodeSelect: vi.fn() }))

vi.mock('../../../../../hooks/use-nodes-interactions', () => ({
  useNodesInteractions: () => ({ handleNodeSelect }),
}))
vi.mock('../../../../../hooks/use-tool-icon', () => ({ useToolIcon: () => '' }))
vi.mock('../../../../../hooks/use-workflow', () => ({
  useNodesReadOnly: () => ({ nodesReadOnly: false }),
}))
vi.mock('../../../../../hooks/use-available-blocks', () => ({
  useAvailableBlocks: () => ({ availablePrevBlocks: [], availableNextBlocks: [] }),
}))

// Real CSS and sequential focus catch controls skipped by Tab or hidden when menu focus returns.
it('reveals next-step actions to keyboard users and keeps restored focus visible', async () => {
  await render(
    <>
      <button type="button">Before next step</button>
      <div style={{ width: 400, marginTop: 80 }}>
        <Item
          nodeId="next-node"
          sourceHandle="source"
          data={{ type: BlockEnum.Code, title: 'Transform', desc: '' } as CommonNodeType}
        />
      </div>
    </>,
  )
  await page.getByRole('button', { name: 'Before next step' }).click()
  await userEvent.keyboard('{Tab}')
  const jump = page.getByRole('button', { name: 'workflow.common.jumpToNode' })
  await expect.element(jump).toHaveFocus()
  expect(jump.element().checkVisibility({ opacityProperty: true })).toBe(true)
  await userEvent.keyboard('{Enter}')
  expect(handleNodeSelect).toHaveBeenCalledWith('next-node')

  await userEvent.keyboard('{Tab}')
  const more = page.getByRole('button', { name: 'workflow.common.moreActions' })
  await expect.element(more).toHaveFocus()
  expect(more.element().checkVisibility({ opacityProperty: true })).toBe(true)
  await userEvent.keyboard('{Enter}')
  await expect.element(page.getByRole('menuitem', { name: 'workflow.panel.change' })).toHaveFocus()
  await userEvent.keyboard('{Escape}')

  await expect.element(page.getByRole('menu')).not.toBeInTheDocument()
  await expect.element(more).toHaveFocus()
  expect(more.element().checkVisibility({ opacityProperty: true })).toBe(true)
})
