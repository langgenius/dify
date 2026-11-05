import type { Recipient } from '../../../../types'
import { useState } from 'react'
import { page } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import MemberList from '../member-list'
import { members } from './recipient-test-data'

beforeEach(async () => {
  await page.viewport(1280, 900)
  onTestFinished(guardUnexpectedFetch())
})

it('filters members and applies selection so the same recipient cannot be added twice', async () => {
  function Caller() {
    const [searchValue, setSearchValue] = useState('pending')
    const [value, setValue] = useState<Recipient[]>([{ type: 'member', user_id: 'member-1' }])
    return (
      <>
        <MemberList
          value={value}
          searchValue={searchValue}
          onSearchChange={setSearchValue}
          list={[
            { ...members[0]!, name: 'Owner', email: 'owner@example.com' },
            { ...members[1]!, name: 'Pending User', status: 'pending' },
          ]}
          onSelect={(user_id) => setValue((previous) => [...previous, { type: 'member', user_id }])}
          email="owner@example.com"
        />
        <output aria-label="Recipients">{JSON.stringify(value)}</output>
      </>
    )
  }
  await render(<Caller />)
  const search = page.getByRole('searchbox', { name: 'common.operation.search' })
  await search.fill('owner')
  await expect.element(page.getByRole('button', { name: /Owner/ })).toBeDisabled()
  await expect.element(page.getByText('workspaceMembers.members.you')).toBeVisible()
  await expect.element(page.getByText('Pending User')).not.toBeInTheDocument()
  await search.fill('pending')
  await expect.element(page.getByText('workspaceMembers.members.pending')).toBeVisible()
  const pending = page.getByRole('button', { name: /Pending User/ })
  await pending.click()
  await expect.element(pending).toBeDisabled()
  await expect
    .element(page.getByRole('status', { name: 'Recipients' }))
    .toHaveTextContent(
      '[{"type":"member","user_id":"member-1"},{"type":"member","user_id":"member-2"}]',
    )
})

it('hides compact suggestions when no members match', async () => {
  await render(
    <MemberList
      value={[]}
      searchValue="missing"
      onSearchChange={vi.fn()}
      list={members}
      onSelect={vi.fn()}
      email="owner@example.com"
      hideSearch
    />,
  )
  await expect.element(page.getByRole('button')).not.toBeInTheDocument()
  await expect.element(page.getByRole('searchbox')).not.toBeInTheDocument()
})
