import type { ToolActivity } from '../tool-activity-item'
import { page } from 'vite-plus/test/browser'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import { renderChatOwner } from '../../__tests__/chat-owner-preset'
import { ToolActivityItem } from '../tool-activity-item'

vi.unmock('react-i18next')

beforeEach(async () => {
  await page.viewport(1000, 800)
  onTestFinished(guardUnexpectedFetch())
})

const rejectedCall: ToolActivity = {
  kind: 'tool',
  key: 'run:rejected',
  name: 'search',
  label: 'Search repositories with a long localized operation name',
  input: '{"query":"rust"}',
  output: '',
  isFinished: true,
  status: 'not_executed',
  callLimit: {
    tool_identity: 'operation',
    limit: 3,
    used: 3,
    reason: 'call_limit_reached',
    execution_status: 'not_executed',
  },
}

it('keeps narrow-panel calls readable and restores inline usage when the panel widens', async () => {
  const calls = (width: number) => (
    <section style={{ width }} aria-label="Tool calls">
      <ToolActivityItem tool={rejectedCall} />
      <ToolActivityItem tool={{ ...rejectedCall, key: 'run:following', label: 'Following call' }} />
    </section>
  )
  const screen = await renderChatOwner(calls(340))
  const trigger = page.getByRole('button', { name: new RegExp(rejectedCall.label) })
  const following = page.getByRole('button', { name: /Following call/ })
  const status = page.getByRole('status').nth(0)
  const usage = page.getByText('3 of 3 calls used', { exact: true }).nth(0)
  const label = page.getByText(rejectedCall.label, { exact: true })
  await expect.element(status).toBeVisible()
  await expect.element(usage).not.toBeVisible()
  const row = trigger.element().getBoundingClientRect()
  const statusBounds = status.element().getBoundingClientRect()
  expect(statusBounds.top).toBeGreaterThanOrEqual(row.top)
  expect(statusBounds.bottom).toBeLessThanOrEqual(row.bottom)
  expect(statusBounds.right).toBeLessThanOrEqual(row.right)
  expect(label.element().scrollWidth).toBeGreaterThan(label.element().clientWidth)
  expect(following.element().getBoundingClientRect().top).toBeGreaterThanOrEqual(row.bottom)

  await trigger.click()
  const request = page.getByText(rejectedCall.input, { exact: true })
  await expect.element(request).toBeVisible()
  expect(request.element().getBoundingClientRect().top).toBeGreaterThanOrEqual(row.bottom)
  await expect.element(page.getByText('Reason', { exact: true })).toBeVisible()
  await expect.element(page.getByText('Call limit', { exact: true })).not.toBeInTheDocument()

  await screen.rerender(calls(700))
  await expect.element(usage).toBeVisible()
  await expect.element(request).toBeVisible()
  expect(trigger.element().getBoundingClientRect().right).toBeLessThanOrEqual(
    page.getByRole('region', { name: 'Tool calls' }).element().getBoundingClientRect().right,
  )
})

it('labels a failed call error while retaining its original request and response', async () => {
  await renderChatOwner(
    <ToolActivityItem
      tool={{
        ...rejectedCall,
        label: 'Run code',
        status: 'failed',
        input: '{"code":"raise RuntimeError()"}',
        error: 'RuntimeError: QA_EXPECTED_FAILURE',
        output: 'Original tool response',
        callLimit: null,
      }}
    />,
  )
  await page.getByRole('button', { name: /Run code/ }).click()
  await expect.element(page.getByText('Error', { exact: true })).toBeVisible()
  await expect.element(page.getByText('RuntimeError: QA_EXPECTED_FAILURE')).toBeVisible()
  await expect.element(page.getByText('Request', { exact: true })).toBeVisible()
  await expect.element(page.getByText('Response', { exact: true })).toBeVisible()
  await expect.element(page.getByText('Original tool response')).toBeVisible()
  await expect.element(page.getByText('Reason', { exact: true })).not.toBeInTheDocument()
})
