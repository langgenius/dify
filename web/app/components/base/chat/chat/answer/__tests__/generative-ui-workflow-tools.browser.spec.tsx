import type { OpenUiContentBlock } from '@dify/contracts/api/console/agent/types.gen'
import type { ChatItem, WorkflowAgentToolActivity } from '../../../types'
import type { ChatContextValue } from '../../context'
import { page } from 'vite-plus/test/browser'
import { createDeferred } from '@/test/deferred'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import { chatItem, renderChatOwner } from '../../__tests__/chat-owner-preset'
import { ChatContextProvider } from '../../context-provider'
import Answer from '../index'
import { filledForm } from './answer-form-preset'

vi.unmock('react-i18next')
// boundary: the real answer's attachment owners read params without a running Next router.
vi.mock('@/next/navigation', () => ({ useParams: () => ({}), usePathname: () => '/chat' }))

beforeEach(async () => {
  await page.viewport(1000, 800)
  onTestFinished(guardUnexpectedFetch())
})

const runningTool: WorkflowAgentToolActivity = {
  id: 'run-1:call-1',
  node_id: 'research-agent',
  node_execution_id: 'execution-1',
  label: 'shell_run',
  status: 'running',
  error: null,
  data: {
    tool_call_id: 'call-1',
    tool_name: 'shell_run',
    tool_input: '{"script":"summarize sales"}',
    tool_output: '',
    node_title: 'Research agent',
  },
}

const introduction = 'I compared the regional sales.\n\n'
const conclusion = 'Choose a region to continue.'
const block: OpenUiContentBlock = {
  id: 'ui-1',
  type: 'openui',
  library_version: 'dify-ui-v1',
  text_offset: Array.from(introduction).length,
  source: `root = Stack([results, filters])
results = Table("Sales by region", ["Region", "Sales"], [["East", "80"], ["West", "40"]])
filters = Form("filters", "Filter results", "Apply", "Apply these filters", [region])
region = SelectField("region", "Region", ["East", "West"], "East", true)`,
  status: 'streaming',
  sequence: 1,
  form_state: { filters: { region: { value: 'East' } } },
}

it.each([
  { name: 'a standalone answer', humanInputFilledFormDataList: [] },
  { name: 'an answer after human input', humanInputFilledFormDataList: [filledForm] },
])(
  'keeps tool details and generated UI usable in $name and saves before continuing',
  async ({ humanInputFilledFormDataList }) => {
    const onSend = vi.fn()
    const saved = createDeferred()
    const saveState = vi
      .fn<NonNullable<ChatContextValue['onGenerativeUIStateChange']>>()
      .mockReturnValue(saved.promise)
    const renderAnswer = (item: ChatItem, responding: boolean) => (
      <ChatContextProvider
        chatList={[item]}
        isResponding={responding}
        onSend={onSend}
        onGenerativeUIStateChange={saveState}
      >
        <Answer item={item} question="Compare regional sales" index={0} responding={responding} />
      </ChatContextProvider>
    )
    const item = chatItem({
      content: '',
      workflowAgentActivities: [runningTool],
      humanInputFilledFormDataList,
    })
    const screen = await renderChatOwner(renderAnswer(item, true))

    await page.getByRole('button', { name: 'Running commands' }).click()
    await expect.element(page.getByText(runningTool.data.tool_input, { exact: true })).toBeVisible()
    await expect.element(page.getByRole('form', { name: 'Filter results' })).not.toBeInTheDocument()

    const completedTool: WorkflowAgentToolActivity = {
      ...runningTool,
      status: 'succeeded',
      data: { ...runningTool.data, tool_output: 'Sales report loaded' },
    }
    const streamingAnswer: ChatItem = {
      ...item,
      content: introduction,
      workflowAgentActivities: [completedTool],
      content_blocks: [block],
    }
    await screen.rerender(renderAnswer(streamingAnswer, true))

    await expect.element(page.getByRole('button', { name: 'Ran commands' })).toBeVisible()
    await expect.element(page.getByText('Sales report loaded', { exact: true })).toBeVisible()
    await expect
      .element(page.getByText('I compared the regional sales.', { exact: true }))
      .toBeVisible()
    const table = page.getByRole('table', { name: 'Sales by region' })
    await expect.element(table.getByRole('cell', { name: '80' })).toBeVisible()
    const form = page.getByRole('form', { name: 'Filter results' })
    const region = form.getByRole('combobox', { name: 'Region' })
    const submit = form.getByRole('button', { name: 'Apply' })
    await expect.element(region).toBeDisabled()
    await expect.element(submit).toBeDisabled()

    const completedAnswer: ChatItem = {
      ...streamingAnswer,
      content: introduction + conclusion,
      content_blocks: [{ ...block, sequence: 2, status: 'completed' }],
    }
    await screen.rerender(renderAnswer(completedAnswer, true))
    await expect.element(submit).toBeDisabled()
    await screen.rerender(renderAnswer(completedAnswer, false))
    await expect.element(region).toBeEnabled()
    await expect.element(submit).toBeEnabled()
    await expect.element(page.getByText(conclusion, { exact: true })).toBeVisible()

    const toolDetails = page.getByRole('button', { name: 'Ran commands' })
    await toolDetails.click()
    await expect
      .element(page.getByText('Sales report loaded', { exact: true }))
      .not.toBeInTheDocument()
    await toolDetails.click()
    await expect.element(page.getByText('Sales report loaded', { exact: true })).toBeVisible()

    await region.click()
    await page.getByRole('option', { name: 'West', exact: true }).click()
    await expect.element(region).toHaveTextContent('West')
    await submit.click()

    await expect
      .poll(() => saveState)
      .toHaveBeenLastCalledWith(
        item.id,
        block.id,
        expect.objectContaining({
          filters: expect.objectContaining({ region: expect.objectContaining({ value: 'West' }) }),
        }),
      )
    await expect.element(submit).toBeDisabled()
    expect(onSend).not.toHaveBeenCalled()

    saved.resolve()
    await expect
      .poll(() => onSend)
      .toHaveBeenCalledExactlyOnceWith('Apply these filters\n\nregion: West')
    await expect.element(table).toBeVisible()
    await expect.element(toolDetails).toBeVisible()
  },
)
