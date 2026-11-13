import { useState } from 'react'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import KnowledgeSpaceList from '../knowledge-space-list'

const spaces = [
  { control_space_id: 'space-1', name: 'Handbook' },
  { control_space_id: 'space-2', name: 'Policies' },
]

function Selection({ initialSpaces = spaces }: { initialSpaces?: typeof spaces }) {
  const [list, setList] = useState(initialSpaces)
  return <KnowledgeSpaceList list={list} onChange={setList} />
}

beforeEach(async () => {
  await page.viewport(1000, 800)
  onTestFinished(guardUnexpectedFetch())
})

it('reveals the focused removal action and removes the space using the keyboard', async () => {
  await render(
    <>
      <button type="button">before</button>
      <Selection initialSpaces={spaces.slice(0, 1)} />
      <button type="button">after</button>
    </>,
  )
  await page.getByRole('button', { name: 'before' }).click()
  await userEvent.tab()
  const remove = page.getByRole('button', { name: 'common.operation.remove' })
  await expect.element(remove).toHaveFocus()
  // toBeVisible alone ignores ancestor opacity; this proves the focused action is painted.
  await expect.element(remove).toBeInViewport()
  await expect.poll(() => remove.element().checkVisibility({ checkOpacity: true })).toBe(true)
  await userEvent.keyboard('{Enter}')
  await expect.element(page.getByText('Handbook')).not.toBeInTheDocument()
  await expect
    .element(page.getByText('workflow.nodes.knowledgeRetrievalV2.knowledgeTip'))
    .toBeVisible()
})

it('removes only the chosen space through its revealed action', async () => {
  await render(<Selection />)
  await page.getByText('Policies').hover()
  await page.getByRole('button', { name: 'common.operation.remove' }).nth(1).click()
  await expect.element(page.getByText('Policies')).not.toBeInTheDocument()
  await expect.element(page.getByText('Handbook')).toBeVisible()
})

it('hides removal actions when readonly', async () => {
  await render(<KnowledgeSpaceList list={spaces} onChange={vi.fn()} readonly />)
  await expect.element(page.getByText('Handbook')).toBeVisible()
  await expect
    .element(page.getByRole('button', { name: 'common.operation.remove' }))
    .not.toBeInTheDocument()
})
