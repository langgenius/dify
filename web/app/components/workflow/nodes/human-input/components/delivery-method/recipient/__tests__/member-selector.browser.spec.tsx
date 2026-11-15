import type { Recipient } from '../../../../types'
import { useState } from 'react'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import MemberSelector from '../member-selector'
import { members } from './recipient-test-data'

it('filters real members and closes the selector after a keyboard selection', async () => {
  await page.viewport(1280, 900)
  onTestFinished(guardUnexpectedFetch())
  function Caller() {
    const [value, setValue] = useState<Recipient[]>([])
    return (
      <>
        <MemberSelector
          value={value}
          email="owner@example.com"
          list={[members[0]!]}
          onSelect={(user_id) => setValue([{ type: 'member', user_id }])}
        />
        <output aria-label="Recipients">{JSON.stringify(value)}</output>
      </>
    )
  }
  await render(<Caller />)
  const trigger = page.getByRole('button', { name: /memberSelector.trigger/ })
  await trigger.click()
  const search = page.getByRole('searchbox', { name: 'common.operation.search' })
  await search.fill('missing')
  await expect.element(page.getByRole('button', { name: /Member One/ })).not.toBeInTheDocument()
  await search.fill('MEMBER-1@')
  const member = page.getByRole('button', { name: /Member One/ })
  await expect.element(member).toBeVisible()
  await userEvent.tab()
  await expect.element(member).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await expect.element(search).not.toBeInTheDocument()
  await expect
    .element(page.getByRole('status', { name: 'Recipients' }))
    .toHaveTextContent('[{"type":"member","user_id":"member-1"}]')
})
