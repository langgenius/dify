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
    const maxRetriesSlider = screen.getByRole('slider', { name: maxRetriesLabel })
    const maxRetriesGroup = maxRetriesSlider.closest('fieldset')!
    expect(maxRetriesSlider).toHaveAttribute(
      'aria-valuetext',
      '3 workflow.nodes.common.retry.times',
    )
    const maxRetriesInput = within(maxRetriesGroup).getByRole('textbox', {
      name: maxRetriesLabel,
    })
    expect(maxRetriesInput).toHaveAttribute('aria-roledescription', 'Number field')
    expect(maxRetriesInput).toHaveValue('3')
    expect(within(maxRetriesGroup).getByText('workflow.nodes.common.retry.times')).toBeVisible()

    const retryIntervalLabel = 'workflow.nodes.common.retry.retryInterval'
    const retryIntervalSlider = screen.getByRole('slider', { name: retryIntervalLabel })
    const retryIntervalGroup = retryIntervalSlider.closest('fieldset')!
    expect(retryIntervalSlider).toHaveAttribute(
      'aria-valuetext',
      '1000 workflow.nodes.common.retry.ms',
    )
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
