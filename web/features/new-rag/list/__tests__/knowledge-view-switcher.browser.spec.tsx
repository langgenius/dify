import { useState } from 'react'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import { KnowledgeViewSwitcher } from '../knowledge-view-switcher'

function ViewOwner() {
  const [view, setView] = useState<'classic' | 'agent'>('agent')
  return <KnowledgeViewSwitcher value={view} onChange={setView} />
}

beforeEach(async ({ onTestFinished }) => {
  onTestFinished(guardUnexpectedFetch())
  localStorage.clear()
  await page.viewport(640, 600)
})

it('persists guide dismissal without changing the selected knowledge view', async () => {
  const { wrapper: QueryProvider } = createConsoleQueryWrapper()
  await render(
    <QueryProvider>
      <ViewOwner />
    </QueryProvider>,
  )
  const guide = page.getByRole('dialog', { name: 'knowledgeSpace.guideTitle' })
  await guide.getByRole('button', { name: 'knowledgeSpace.gotIt' }).click()

  await expect.element(guide).not.toBeInTheDocument()
  await expect.element(page.getByRole('radio', { name: /knowledgeSpace.view.agent/ })).toBeChecked()
  expect(localStorage.getItem('dify-new-knowledge-guide-dismissed')).toBe('true')

  await page.getByRole('button', { name: 'knowledgeSpace.guideTitle' }).click()
  await expect.element(guide).toBeVisible()
  await guide.getByRole('button', { name: 'knowledgeSpace.gotIt' }).click()
  await expect.element(guide).not.toBeInTheDocument()
  await expect.element(page.getByRole('radio', { name: /knowledgeSpace.view.agent/ })).toBeChecked()
})

it('keeps existing focus for the automatic guide and focuses Got it when explicitly reopened', async () => {
  const { wrapper: QueryProvider } = createConsoleQueryWrapper()
  await render(
    <QueryProvider>
      {/* oxlint-disable-next-line jsx-a11y/no-autofocus -- Existing focus must survive the automatically opened guide. */}
      <button type="button" autoFocus>
        Before switcher
      </button>
      <ViewOwner />
    </QueryProvider>,
  )
  const guide = page.getByRole('dialog', { name: 'knowledgeSpace.guideTitle' })
  await expect.element(guide).toBeVisible()
  await expect.element(page.getByRole('button', { name: 'Before switcher' })).toHaveFocus()
  await guide.getByRole('button', { name: 'knowledgeSpace.gotIt' }).click()
  await expect.element(guide).not.toBeInTheDocument()

  await page.getByRole('button', { name: 'knowledgeSpace.guideTitle' }).click()
  await expect.element(guide.getByRole('button', { name: 'knowledgeSpace.gotIt' })).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await expect.element(guide).not.toBeInTheDocument()
})
