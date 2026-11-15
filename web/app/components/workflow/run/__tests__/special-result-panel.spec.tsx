import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import { createNodeTracing } from '../../__tests__/fixtures'
import SpecialResultPanel from '../special-result-panel'

it('isolates retry detail interactions from the parent tracing card and returns to its summary', async () => {
  const user = userEvent.setup()
  const parentClick = vi.fn()
  const onBack = vi.fn()
  const props = { retryResultList: [createNodeTracing()], setShowRetryDetailFalse: onBack }
  const view = (show: boolean) => (
    <div onClick={parentClick}>
      <SpecialResultPanel {...props} showRetryDetail={show} />
    </div>
  )
  const { rerender } = render(view(true))
  await user.click(screen.getByText('workflow.nodes.common.retry.retry 1'))
  expect(parentClick).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'workflow.singleRun.back' }))
  expect(onBack).toHaveBeenCalledOnce()
  expect(parentClick).not.toHaveBeenCalled()
  rerender(view(false))
  expect(screen.queryByRole('button', { name: 'workflow.singleRun.back' })).not.toBeInTheDocument()
})
