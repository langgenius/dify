import type { ReactNode } from 'react'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NodeRunningStatus } from '@/app/components/workflow/types'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import { createNodeTracing } from '../../../__tests__/fixtures'
import LoopResultPanel from '../loop-result-panel'

vi.mock('@/app/components/workflow/nodes/_base/components/editor/code-editor', () => ({
  default: ({ title, value }: { title: ReactNode; value: unknown }) => (
    <section>
      {title}
      <output aria-label="Loop variables">{JSON.stringify(value)}</output>
    </section>
  ),
}))

it('expands and collapses loop details with the keyboard and returns to the summary', async () => {
  const user = userEvent.setup()
  const onBack = vi.fn()
  render(
    <LoopResultPanel
      list={[
        [
          createNodeTracing({
            title: 'Summarize item',
            status: NodeRunningStatus.Succeeded,
            execution_metadata: { total_tokens: 0, total_price: 0, currency: 'USD', loop_index: 0 },
          }),
        ],
      ]}
      onBack={onBack}
      loopDurationMap={{ 0: 1.2 }}
      loopVariableMap={{ 0: { item: 'alpha' } }}
    />,
  )
  const header = screen.getByRole('button', { name: /workflow.singleRun.loop 1/ })
  expect(header).toHaveTextContent('1.20s')
  expect(header).toHaveAttribute('aria-expanded', 'false')
  expect(screen.queryByRole('status', { name: 'Loop variables' })).not.toBeInTheDocument()
  header.focus()
  await user.keyboard('{Enter}')
  expect(header).toHaveAttribute('aria-expanded', 'true')
  expect(screen.getByRole('status', { name: 'Loop variables' })).toHaveTextContent(
    '{"item":"alpha"}',
  )
  expect(screen.getByText('Summarize item')).toBeInTheDocument()
  await user.keyboard(' ')
  expect(header).toHaveAttribute('aria-expanded', 'false')
  expect(screen.queryByRole('status', { name: 'Loop variables' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'workflow.singleRun.back' }))
  expect(onBack).toHaveBeenCalledOnce()
})

it.each([
  { metadata: { loop_index: 2 }, variables: { 2: { item: 'alpha' } }, expected: 'alpha' },
  {
    metadata: { loop_index: 2, parallel_mode_run_id: 'parallel-1' },
    variables: { 2: { item: 'wrong' }, 'parallel-1': { item: 'beta' } },
    expected: 'beta',
  },
])(
  'resolves compacted loop rows using execution metadata $metadata',
  async ({ metadata, variables, expected }) => {
    const user = userEvent.setup()
    render(
      <LoopResultPanel
        list={[
          [
            createNodeTracing({
              execution_metadata: { total_tokens: 0, total_price: 0, currency: 'USD', ...metadata },
            }),
          ],
        ]}
        onBack={vi.fn()}
        loopVariableMap={variables}
      />,
    )
    await user.click(screen.getByRole('button', { name: /workflow.singleRun.loop 1/ }))
    expect(screen.getByRole('status', { name: 'Loop variables' })).toHaveTextContent(
      JSON.stringify({ item: expected }),
    )
  },
)
