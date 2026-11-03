import type { RecipientData } from '../../../../types'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { createAccountProfileQueryWrapper } from '@/test/console/account-profile'
import { render } from '@/test/console/render'
import Recipient from '../index'

vi.mock('@/context/workspace-state', async () => {
  const { createWorkspaceStateModuleMock } = await import('@/test/console/state-fixture')
  return createWorkspaceStateModuleMock(() => ({ currentWorkspace: { name: "Dify's Lab" } }))
})
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
  const user = userEvent.setup()
  render(<RecipientForm />, {
    wrapper: createAccountProfileQueryWrapper({ email: 'owner@example.com' }),
  })
  await user.click(screen.getByRole('button', { name: /memberSelector.trigger/ }))
  await user.click(await screen.findByRole('button', { name: /Member One/ }))
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: /Member One/ })).not.toBeInTheDocument(),
  )
  expect(screen.getByText('member-1@example.com')).toBeVisible()
  const input = screen.getByRole('textbox')
  await user.type(input, 'external@example.com{Enter}')
  expect(screen.getByText('external@example.com')).toBeVisible()
  await user.type(input, 'member-2@example.com{Enter}')
  expect(screen.getByRole('status', { name: 'Recipients' })).toHaveTextContent(
    JSON.stringify({
      whole_workspace: false,
      items: [
        { type: 'member', user_id: 'member-1' },
        { type: 'external', email: 'external@example.com' },
        { type: 'member', user_id: 'member-2' },
      ],
    }),
  )
  await user.keyboard('{Backspace}{Backspace}')
  expect(screen.queryByText('external@example.com')).not.toBeInTheDocument()
  expect(screen.queryByText('member-2@example.com')).not.toBeInTheDocument()
  await user.click(screen.getByRole('switch', { name: /allMembers/ }))
  expect(screen.getByRole('switch')).toBeChecked()
  expect(screen.getByRole('status', { name: 'Recipients' })).toHaveTextContent(
    JSON.stringify({
      whole_workspace: true,
      items: [{ type: 'member', user_id: 'member-1' }],
    }),
  )
})
