import type { Props as CodeEditorProps } from '@/app/components/workflow/nodes/_base/components/editor/code-editor'
import type { ConsoleClient } from '@/service/console'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithConsoleQuery as render } from '@/test/console/query-data'
import AgentLogModal from '../index'
import { createChatLog, createLogResponse } from './fixtures'

const { getAgentLog } = vi.hoisted(() => ({
  getAgentLog: vi.fn<ConsoleClient['apps']['byAppId']['agent']['logs']['get']>(),
}))

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { createConsoleQuery } = await import('@/service/console/query-policies')
  const { withAgentLogOperation } = await import('./fixtures')
  const consoleClient = withAgentLogOperation(actual.consoleClient, getAgentLog)
  return { ...actual, consoleClient, consoleQuery: createConsoleQuery(consoleClient) }
})

vi.mock('@/app/components/workflow/nodes/_base/components/editor/code-editor', async () => {
  const { serializeCodeEditorValue } =
    await import('@/app/components/workflow/nodes/_base/components/editor/code-editor/utils')
  return {
    default: ({ title, value, isJSONStringifyBeauty }: CodeEditorProps) => (
      <section>
        {title}
        <pre>{serializeCodeEditorValue(value, isJSONStringifyBeauty)}</pre>
      </section>
    ),
  }
})

vi.mock('@/hooks/use-timestamp', () => ({
  default: () => ({ formatTime: () => '2024-03-12 10:00' }),
}))

const defaultProps = { appId: 'app-id', currentLogItem: createChatLog(), width: 1000 }

beforeEach(() => {
  getAgentLog.mockReset()
  getAgentLog.mockResolvedValue(createLogResponse())
})

describe('Agent log modal', () => {
  it.each([undefined, createChatLog({ conversationId: undefined })])(
    'does not request logs without a selected conversation',
    (currentLogItem) => {
      render(<AgentLogModal {...defaultProps} currentLogItem={currentLogItem} onCancel={vi.fn()} />)
      expect(screen.queryByRole('heading')).not.toBeInTheDocument()
      expect(getAgentLog).not.toHaveBeenCalled()
    },
  )

  it('opens the selected log and closes through its visible close button', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    render(<AgentLogModal {...defaultProps} onCancel={onCancel} />)
    expect(await screen.findByText('Output content')).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'appLog.runDetail.workflowTitle' }),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'common.operation.close' }))
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('closes the nonfloating panel when the user clicks outside it', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    render(
      <>
        <button type="button">Outside</button>
        <AgentLogModal {...defaultProps} onCancel={onCancel} />
      </>,
    )
    await screen.findByText('Output content')
    await user.click(screen.getByRole('button', { name: 'Outside' }))
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('opens the floating dialog with its title and closes through Escape', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    render(<AgentLogModal {...defaultProps} floating onCancel={onCancel} />)
    const dialog = await screen.findByRole('dialog', { name: 'appLog.runDetail.workflowTitle' })
    expect(dialog).toBeInTheDocument()
    await screen.findByText('Output content')
    await user.keyboard('{Escape}')
    await waitFor(() => expect(onCancel).toHaveBeenCalledOnce())
  })
})
