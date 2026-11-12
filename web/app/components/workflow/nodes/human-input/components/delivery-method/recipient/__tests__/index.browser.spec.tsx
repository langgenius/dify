import type { RecipientData } from '../../../../types'
import { useState } from 'react'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import Recipient from '../index'

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'workspaces.current.members.get': () =>
        Promise.resolve({
          accounts: [
            {
              id: 'member-1',
              email: 'member-1@example.com',
              name: 'Member One',
              avatar_url: null,
              role: 'normal',
              status: 'active',
            },
            {
              id: 'member-2',
              email: 'member-2@example.com',
              name: 'Member Two',
              avatar_url: null,
              role: 'normal',
              status: 'active',
            },
          ],
        }),
    }),
  }
})

it('retains member and external recipients through additions, deletions and workspace delivery changes', async () => {
  function RecipientForm() {
    const [data, setData] = useState<RecipientData>({ whole_workspace: false, items: [] })
    return (
      <>
        <Recipient data={data} onChange={setData} />
        <output aria-label="Recipients">{JSON.stringify(data)}</output>
      </>
    )
  }
  await page.viewport(1280, 900)
  onTestFinished(guardUnexpectedFetch())
  const { wrapper } = createConsoleQueryWrapper({
    accountProfile: { email: 'owner@example.com' },
    currentWorkspace: { name: "Dify's Lab" },
  })
  await render(<RecipientForm />, { wrapper })
  await userEvent.click(page.getByRole('button', { name: /memberSelector.trigger/ }))
  await userEvent.click(page.getByRole('button', { name: /Member One/ }))
  await expect.element(page.getByRole('button', { name: /Member One/ })).not.toBeInTheDocument()
  await expect.element(page.getByText('member-1@example.com')).toBeVisible()
  const input = page.getByRole('textbox')
  await input.fill('external@example.com')
  await userEvent.keyboard('{Enter}')
  await expect.element(page.getByText('external@example.com')).toBeVisible()
  await input.fill('member-2@example.com')
  await userEvent.keyboard('{Enter}')
  await expect.element(page.getByRole('status', { name: 'Recipients' })).toHaveTextContent(
    JSON.stringify({
      whole_workspace: false,
      items: [
        { type: 'member', user_id: 'member-1' },
        { type: 'external', email: 'external@example.com' },
        { type: 'member', user_id: 'member-2' },
      ],
    }),
  )
  await userEvent.keyboard('{Backspace}')
  await expect.element(page.getByText('member-2@example.com')).not.toBeInTheDocument()
  await userEvent.keyboard('{Backspace}')
  await expect.element(page.getByText('external@example.com')).not.toBeInTheDocument()
  await expect.element(page.getByText('member-2@example.com')).not.toBeInTheDocument()
  await userEvent.click(page.getByRole('switch', { name: /allMembers/ }))
  await expect.element(page.getByRole('switch')).toBeChecked()
  await expect.element(page.getByRole('status', { name: 'Recipients' })).toHaveTextContent(
    JSON.stringify({
      whole_workspace: true,
      items: [{ type: 'member', user_id: 'member-1' }],
    }),
  )
})
