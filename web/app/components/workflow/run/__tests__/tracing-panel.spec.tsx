import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createNodeTracing } from '@/app/components/workflow/__tests__/fixtures'
import { NodeRunningStatus } from '@/app/components/workflow/types'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import { getHoveredParallelId } from '../get-hovered-parallel-id'
import TracingPanel from '../tracing-panel'

it('formats parallel branches and supports keyboard collapse without bubbling to its parent', async () => {
  const user = userEvent.setup()
  const parentClick = vi.fn()
  render(
    <div onClick={parentClick}>
      <TracingPanel
        list={[
          createNodeTracing({
            node_id: 'first',
            title: 'First',
            parallel_id: 'parallel',
            parallel_start_node_id: 'first',
          }),
          createNodeTracing({
            node_id: 'child',
            title: 'Child',
            parallel_id: 'parallel',
            parallel_start_node_id: 'first',
            index: 1,
          }),
          createNodeTracing({ node_id: 'end', title: 'End', index: 2 }),
        ]}
        hideNodeInfo
        hideNodeProcessDetail
      />
    </div>,
  )
  expect(screen.getByText('workflow.common.branch-1-A')).toBeInTheDocument()
  const toggle = screen.getByRole('button', { name: 'workflow.common.parallel-1', expanded: true })
  expect(screen.getByText('Child')).toBeVisible()
  expect(screen.queryByRole('button', { name: /Child/ })).not.toBeInTheDocument()
  toggle.focus()
  await user.keyboard('{Enter}')
  expect(toggle).toHaveAttribute('aria-expanded', 'false')
  expect(screen.getByText('Child')).not.toBeVisible()
  expect(screen.getByText('End')).toBeVisible()
  await user.keyboard(' ')
  expect(screen.getByText('Child')).toBeVisible()
  expect(parentClick).not.toHaveBeenCalled()
})

it('opens real retry details and returns to the trace', async () => {
  const user = userEvent.setup()
  render(
    <TracingPanel
      list={[
        createNodeTracing({
          id: 'attempt-1',
          node_id: 'code',
          title: 'Attempt',
          status: NodeRunningStatus.Retry,
          error: 'Temporary error',
        }),
        createNodeTracing({
          id: 'finished',
          node_id: 'code',
          title: 'Completed code',
          status: NodeRunningStatus.Succeeded,
          index: 1,
        }),
      ]}
    />,
  )
  await user.click(screen.getByRole('button', { name: /Completed code/ }))
  await user.click(
    screen.getByRole('button', { name: 'workflow.nodes.common.retry.retries:{"num":1}' }),
  )
  expect(screen.queryByText('Completed code')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: /workflow.nodes.common.retry.retry 1/ }))
  expect(screen.getByText('Temporary error')).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'workflow.singleRun.back' }))
  expect(screen.getByText('Completed code')).toBeVisible()
})

it('should resolve hovered parallel ids from related targets', () => {
  const sameParallelTarget = document.createElement('div')
  sameParallelTarget.setAttribute('data-parallel-id', 'parallel-1')
  document.body.appendChild(sameParallelTarget)

  const nestedChild = document.createElement('span')
  sameParallelTarget.appendChild(nestedChild)

  const unrelatedTarget = document.createElement('div')

  expect(getHoveredParallelId(nestedChild)).toBe('parallel-1')
  expect(getHoveredParallelId(unrelatedTarget)).toBeNull()
  expect(getHoveredParallelId(null)).toBeNull()

  sameParallelTarget.remove()
})
