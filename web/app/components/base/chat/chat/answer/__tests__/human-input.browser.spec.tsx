import type { ChatItem } from '../../../types'
import { useState } from 'react'
import { page, userEvent } from 'vite-plus/test/browser'
import { WorkflowRunningStatus } from '@/app/components/workflow/types'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import { chatItem, renderChatOwner } from '../../__tests__/chat-owner-preset'
import Answer from '../index'
import { filledForm, pendingForm } from './answer-form-preset'

vi.unmock('react-i18next')
// boundary: attachment controls read route params without an application router.
vi.mock('@/next/navigation', () => ({ useParams: () => ({}), usePathname: () => '/chat' }))

beforeEach(async () => {
  await page.viewport(1000, 800)
  onTestFinished(guardUnexpectedFetch())
})

function ReviewOwner() {
  const [submission, setSubmission] = useState<{
    token: string
    action: string
    inputs: Record<string, unknown>
  }>()
  return (
    <>
      <Answer
        item={chatItem({
          content: '',
          humanInputFormDataList: submission ? undefined : [pendingForm],
          humanInputFilledFormDataList: submission ? [filledForm] : undefined,
        })}
        question="Question"
        index={0}
        onHumanInputFormSubmit={async (token, data) => {
          setSubmission({ token, action: data.action, inputs: data.inputs })
        }}
      />
      <output aria-label="Saved review">
        {submission
          ? `${submission.token}: ${submission.action} ${JSON.stringify(submission.inputs)}`
          : 'Not submitted'}
      </output>
    </>
  )
}

it('submits the real form and exposes its completed response through keyboard disclosure', async () => {
  await renderChatOwner(<ReviewOwner />)
  await expect.element(page.getByText('Please approve this response.')).toBeVisible()
  await page.getByRole('button', { name: 'Approve', exact: true }).click()
  await expect
    .element(page.getByRole('status', { name: 'Saved review' }))
    .toHaveTextContent('form-token: approve {}')
  await expect.element(page.getByText('Please approve this response.')).not.toBeInTheDocument()
  await expect.element(page.getByText('Approved response')).not.toBeInTheDocument()
  const disclosure = page.getByRole('button', { name: 'Expand Completed review' })
  await disclosure.click()
  await expect.element(page.getByText('Approved response')).toBeVisible()
  await expect.element(page.getByText('approve', { exact: true })).toBeVisible()
  await expect
    .element(page.getByRole('button', { name: 'Collapse Completed review' }))
    .toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await expect.element(page.getByText('Approved response')).not.toBeInTheDocument()
})

it.each([false, true])(
  'keeps live reasoning readable and collapses it on completion with human inputs = %s',
  async (human) => {
    const item = chatItem({
      content: '',
      reasoningContent: { llm: 'Reasoning before the answer' },
      humanInputFormDataList: human ? [pendingForm] : undefined,
    })
    const screen = await renderChatOwner(
      <Answer item={item} question="Question" index={0} responding />,
    )
    await expect.element(page.getByText('Reasoning before the answer')).toBeVisible()
    await expect.element(page.getByText(/^Thinking/)).toBeVisible()
    await screen.rerender(
      <Answer
        item={{ ...item, content: 'Final answer', reasoningFinished: true }}
        question="Question"
        index={0}
        responding={false}
      />,
    )
    await expect.element(page.getByText('Final answer')).toBeVisible()
    await expect.element(page.getByText('Reasoning before the answer')).not.toBeVisible()
    const summary = page.getByText(/^Thought/)
    await summary.click()
    await expect.element(page.getByText('Reasoning before the answer')).toBeVisible()
    // Native details owns focus and keyboard collapse, including in the form layout.
    await userEvent.keyboard('{Enter}')
    await expect.element(page.getByText('Reasoning before the answer')).not.toBeVisible()
  },
)

it('retains rehydrated reasoning beside a completed form when answer text is empty', async () => {
  await renderChatOwner(
    <Answer
      item={chatItem({
        content: '',
        reasoningContent: { llm: 'Reload reasoning' },
        reasoningFinished: true,
        humanInputFilledFormDataList: [filledForm],
      })}
      question="Question"
      index={0}
    />,
  )
  await page.getByText(/^Thought/).click()
  await expect.element(page.getByText('Reload reasoning')).toBeVisible()
  await expect.element(page.getByText('Completed review', { exact: true })).toBeVisible()
})

it('omits reasoning for both absent and empty persisted maps', async () => {
  const item = chatItem()
  const screen = await renderChatOwner(<Answer item={item} question="Question" index={0} />)
  await expect.element(page.getByText('An answer')).toBeVisible()
  await expect.element(page.getByText(/^(Thinking|Thought)/)).not.toBeInTheDocument()
  await screen.rerender(
    <Answer item={{ ...item, reasoningContent: {} }} question="Question" index={0} />,
  )
  await expect.element(page.getByText(/^(Thinking|Thought)/)).not.toBeInTheDocument()
})

it.each([false, true])(
  'honors workflow visibility in the real answer layout with human inputs = %s',
  async (human) => {
    const item: ChatItem = chatItem({
      workflowProcess: { status: WorkflowRunningStatus.Running, tracing: [] },
      humanInputFormDataList: human ? [pendingForm] : undefined,
    })
    const props = { item, question: 'Question', index: 0, hideProcessDetail: true }
    const screen = await renderChatOwner(
      <Answer
        {...props}
        appData={{
          app_id: 'app',
          custom_config: null,
          site: { title: 'App', show_workflow_steps: false },
        }}
      />,
    )
    await expect
      .element(page.getByRole('button', { name: /Workflow Process/ }))
      .not.toBeInTheDocument()
    await screen.rerender(
      <Answer
        {...props}
        appData={{
          app_id: 'app',
          custom_config: null,
          site: { title: 'App', show_workflow_steps: true },
        }}
      />,
    )
    const process = page.getByRole('button', { name: /Workflow Process/ })
    await expect.element(process).toHaveAttribute('aria-expanded', 'false')
    await expect.element(page.getByRole('img', { name: 'Workflow Process running' })).toBeVisible()
    await process.click()
    await expect.element(process).toHaveAttribute('aria-expanded', 'true')
    await expect.element(process).toHaveFocus()
    await userEvent.keyboard('{Space}')
    await expect.element(process).toHaveAttribute('aria-expanded', 'false')
  },
)
