import type { Node } from '@/app/components/workflow/types'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import RetryOnPanel from '../retry-on-panel'

const { mockHandleRetryConfigChange } = vi.hoisted(() => ({
  mockHandleRetryConfigChange: vi.fn(),
}))

vi.mock('../hooks', () => ({
  useRetryConfig: () => ({
    handleRetryConfigChange: mockHandleRetryConfigChange,
  }),
}))

const data = {
  retry_config: {
    retry_enabled: true,
    max_retries: 3,
    retry_interval: 1000,
  },
} as Node['data']

describe('RetryOnPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should label the retry switch and grouped value controls', () => {
    render(<RetryOnPanel id="node-1" data={data} />)

    expect(
      screen.getByRole('switch', { name: 'workflow.nodes.common.retry.retryOnFailure' }),
    ).toBeChecked()

    const maxRetriesLabel = 'workflow.nodes.common.retry.maxRetries'
    const maxRetriesGroup = screen.getByRole('group', { name: maxRetriesLabel })
    expect(within(maxRetriesGroup).getByRole('slider', { name: maxRetriesLabel })).toHaveAttribute(
      'aria-valuenow',
      '3',
    )
    const maxRetriesInput = within(maxRetriesGroup).getByRole('textbox', {
      name: maxRetriesLabel,
    })
    expect(maxRetriesInput).toHaveAttribute('aria-roledescription', 'Number field')
    expect(maxRetriesInput).toHaveValue('3')
    expect(within(maxRetriesGroup).getByText('workflow.nodes.common.retry.times')).toBeVisible()

    const retryIntervalLabel = 'workflow.nodes.common.retry.retryInterval'
    const retryIntervalGroup = screen.getByRole('group', { name: retryIntervalLabel })
    expect(
      within(retryIntervalGroup).getByRole('slider', { name: retryIntervalLabel }),
    ).toHaveAttribute('aria-valuenow', '1000')
    expect(
      within(retryIntervalGroup).getByRole('textbox', { name: retryIntervalLabel }),
    ).toHaveValue('1000')
    expect(within(retryIntervalGroup).getByText('workflow.nodes.common.retry.ms')).toBeVisible()
  })

  it('should update retry configuration through native control interactions', async () => {
    const user = userEvent.setup()
    render(<RetryOnPanel id="node-1" data={data} />)

    await user.click(
      screen.getByRole('switch', { name: 'workflow.nodes.common.retry.retryOnFailure' }),
    )
    expect(mockHandleRetryConfigChange).toHaveBeenLastCalledWith({
      retry_enabled: false,
      max_retries: 3,
      retry_interval: 1000,
    })

    const maxRetriesInput = screen.getByRole('textbox', {
      name: 'workflow.nodes.common.retry.maxRetries',
    })
    await user.click(maxRetriesInput)
    await user.keyboard('{ArrowUp}')

    expect(mockHandleRetryConfigChange).toHaveBeenLastCalledWith({
      retry_enabled: true,
      max_retries: 4,
      retry_interval: 1000,
    })
  })
})
