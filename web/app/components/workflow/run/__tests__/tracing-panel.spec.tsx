import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import TracingPanel from '../tracing-panel'

// Formatting and node details have their own behavior tests; this panel owns group collapse.
vi.mock('@/app/components/workflow/run/utils/format-log', () => ({
  default: () => [
    {
      id: 'parallel-1',
      parallelDetail: {
        isParallelStartNode: true,
        parallelTitle: 'Parallel Group',
        children: [{ id: 'child-1', title: 'Child Node' }],
      },
    },
  ],
}))

vi.mock('../node', () => ({
  default: ({ nodeInfo }: { nodeInfo: { title: string } }) => <div>{nodeInfo.title}</div>,
}))

it('collapses and reopens parallel groups without propagating clicks to the containing chat', async () => {
  const user = userEvent.setup()
  const parentClick = vi.fn()
  render(
    <div onClick={parentClick}>
      <TracingPanel list={[]} />
    </div>,
  )

  const toggle = screen.getByRole('button', { name: 'Parallel Group', expanded: true })
  await user.click(toggle)
  expect(
    screen.getByRole('button', { name: 'Parallel Group', expanded: false }),
  ).toBeInTheDocument()
  await user.click(toggle)
  expect(screen.getByRole('button', { name: 'Parallel Group', expanded: true })).toBeInTheDocument()
  expect(parentClick).not.toHaveBeenCalled()
})
