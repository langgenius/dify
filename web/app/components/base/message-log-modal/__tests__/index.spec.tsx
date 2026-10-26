import type { ComponentProps } from 'react'
import type Run from '@/app/components/workflow/run'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import MessageLogModal from '../index'

const run = vi.hoisted(() => vi.fn<(_props: ComponentProps<typeof Run>) => null>(() => null))
// The run viewer is independently tested; this owner selects its run and tab.
vi.mock('@/app/components/workflow/run', () => ({
  default: (props: ComponentProps<typeof Run>) => run(props),
}))
const log = { id: 'message-1', content: 'Message', isAnswer: true, workflow_run_id: 'run-1' }

it.each([undefined, { ...log, workflow_run_id: undefined }])(
  'omits the viewer without a workflow run: %j',
  (currentLogItem) => {
    const { container } = render(
      <MessageLogModal
        appId="app-1"
        width={800}
        onCancel={vi.fn()}
        currentLogItem={currentLogItem}
      />,
    )
    expect(container).toBeEmptyDOMElement()
    expect(run).not.toHaveBeenCalled()
  },
)

it.each([false, true])(
  'selects the message run and closes its viewer (fixed=%s)',
  async (fixedWidth) => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    render(
      <MessageLogModal
        appId="inspected-app"
        width={800}
        onCancel={onCancel}
        currentLogItem={log}
        defaultTab="TRACING"
        fixedWidth={fixedWidth}
      />,
    )
    expect(run).toHaveBeenLastCalledWith(
      expect.objectContaining({
        appId: 'inspected-app',
        activeTab: 'TRACING',
        hideResult: true,
        runDetailUrl: '/apps/inspected-app/workflow-runs/run-1',
        tracingListUrl: '/apps/inspected-app/workflow-runs/run-1/node-executions',
      }),
    )
    await user.click(screen.getByRole('button', { name: 'common.operation.close' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
  },
)

it('dismisses the fixed viewer on an outside click but not an inside click', async () => {
  const user = userEvent.setup()
  const onCancel = vi.fn()
  render(
    <>
      <button type="button">Outside viewer</button>
      <MessageLogModal
        appId="app-1"
        width={800}
        onCancel={onCancel}
        currentLogItem={log}
        fixedWidth
      />
    </>,
  )
  await user.click(screen.getByRole('heading', { name: 'appLog.runDetail.title' }))
  expect(onCancel).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'Outside viewer' }))
  expect(onCancel).toHaveBeenCalledTimes(1)
})
