import type { ChatItem } from '../../../types'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { PromptMode } from '@/models/debug'
import { ChatContextProvider } from '../../context-provider'
import { Operation } from '../operation'

const feedback = vi.hoisted(() => ({ onFeedback: vi.fn() }))

// These independently owned features do not participate in feedback focus restoration.
vi.mock('@/app/components/app/annotation/edit-annotation-modal', () => ({ default: () => null }))
vi.mock(
  '@/app/components/base/features/new-feature-panel/annotation-reply/annotation-ctrl-button',
  () => ({ default: () => null }),
)
vi.mock('@/app/components/base/new-audio-button', () => ({ default: () => null }))
vi.mock('@/app/components/base/chat/chat/log', () => ({ default: () => null }))

const item: ChatItem = { id: 'answer', content: 'An answer', isAnswer: true }

function FeedbackAnswer({ admin = false }: { admin?: boolean }) {
  return (
    <ChatContextProvider
      chatList={[item]}
      config={{
        opening_statement: '',
        pre_prompt: '',
        prompt_type: PromptMode.simple,
        user_input_form: [],
        more_like_this: { enabled: false },
        suggested_questions_after_answer: { enabled: false },
        speech_to_text: { enabled: false },
        text_to_speech: { enabled: false },
        retriever_resource: { enabled: false },
        sensitive_word_avoidance: { enabled: false },
        agent_mode: { enabled: false, tools: [] },
        dataset_configs: {
          retrieval_model: 'single',
          reranking_model: { reranking_provider_name: '', reranking_model_name: '' },
          top_k: 4,
          score_threshold_enabled: false,
          score_threshold: null,
          datasets: { datasets: [] },
        },
        supportFeedback: true,
        supportAnnotation: admin,
      }}
      onFeedback={feedback.onFeedback}
    >
      <button type="button">Before answer</button>
      <article aria-label="Answer" className="group relative m-10 h-32 w-96">
        <p>{item.content}</p>
        <Operation
          item={item}
          question="Question"
          index={0}
          maxSize={500}
          contentWidth={100}
          hasWorkflowProcess={false}
        />
      </article>
    </ChatContextProvider>
  )
}

// The exit transition is rendered by Chromium; the default test setup disables it.
it.each(['cancel', 'submit'])(
  'preserves the feedback draft during the %s exit animation',
  async (close) => {
    const settings = globalThis as typeof globalThis & { BASE_UI_ANIMATIONS_DISABLED: boolean }
    const animationsDisabled = settings.BASE_UI_ANIMATIONS_DISABLED
    settings.BASE_UI_ANIMATIONS_DISABLED = false
    feedback.onFeedback.mockReset().mockResolvedValue(undefined)
    try {
      const screen = await render(<FeedbackAnswer />)
      await screen.getByRole('article', { name: 'Answer' }).hover()
      const trigger = screen.getByRole('button', {
        name: 'appLog.table.header.userRate: appLog.detail.operation.dislike',
      })
      await trigger.click()
      const dialog = screen.getByRole('dialog')
      const popup = dialog.element()
      const textbox = dialog.getByRole('textbox')
      await textbox.fill('Please explain the answer')
      await expect.poll(() => getComputedStyle(popup).opacity).toBe('1')
      const input = textbox.element() as HTMLTextAreaElement
      const exitFrame = new Promise<{ draft: string; opacity: number }>((resolve) => {
        const onTransition = (event: Event) => {
          if (event.target !== popup || (event as TransitionEvent).propertyName !== 'opacity')
            return
          popup.removeEventListener('transitionrun', onTransition)
          resolve({ draft: input.value, opacity: Number(getComputedStyle(popup).opacity) })
        }
        popup.addEventListener('transitionrun', onTransition)
      })

      await dialog.getByRole('button', { name: `common.operation.${close}` }).click()

      const closing = await exitFrame
      expect(closing.opacity).toBeGreaterThan(0)
      expect(closing.draft).toBe('Please explain the answer')
      await expect.element(dialog).not.toBeInTheDocument()
      await expect.element(trigger).toHaveFocus()
      if (close === 'cancel') {
        await trigger.click()
        await expect.element(screen.getByRole('dialog').getByRole('textbox')).toHaveValue('')
        await userEvent.keyboard('{Escape}')
        await expect.element(dialog).not.toBeInTheDocument()
      }
    } finally {
      settings.BASE_UI_ANIMATIONS_DISABLED = animationsDisabled
    }
  },
)

describe('Feedback dialog focus', () => {
  beforeEach(() => {
    feedback.onFeedback.mockReset().mockResolvedValue(undefined)
  })

  // Browser-owned contract: CSS hover visibility must not make the return target unfocusable.
  it.each([
    { admin: false, close: 'Escape' },
    { admin: true, close: 'cancel' },
    { admin: false, close: 'submit' },
    { admin: true, close: 'submit' },
  ])(
    'returns to the visible feedback button after $close (admin: $admin)',
    async ({ admin, close }) => {
      const screen = await render(<FeedbackAnswer admin={admin} />)
      const trigger = screen.getByRole('button', {
        name: `${admin ? 'appLog.table.header.adminRate' : 'appLog.table.header.userRate'}: appLog.detail.operation.dislike`,
      })
      if (close === 'Escape') {
        await screen.getByRole('button', { name: 'Before answer' }).click()
        await userEvent.keyboard('{Tab}{Tab}')
        await expect.element(trigger).toHaveFocus()
        await userEvent.keyboard('{Enter}')
      } else {
        await screen.getByRole('article', { name: 'Answer' }).hover()
        await trigger.click()
      }
      const dialog = screen.getByRole('dialog')
      await expect.element(dialog).toBeVisible()
      await dialog.getByRole('textbox').hover()
      if (close === 'Escape') await userEvent.keyboard('{Escape}')
      else if (close === 'submit')
        await dialog.getByRole('button', { name: 'common.operation.submit' }).click()
      else await dialog.getByRole('button', { name: 'common.operation.cancel' }).click()

      await expect.element(dialog).not.toBeInTheDocument()
      await expect.element(trigger).toBeVisible()
      await expect.element(trigger).toHaveFocus()
      expect(trigger.element().checkVisibility({ checkOpacity: true })).toBe(true)
      if (close === 'submit') {
        await expect.element(trigger).toHaveAttribute('aria-pressed', 'true')
        expect(feedback.onFeedback).toHaveBeenCalledWith('answer', {
          rating: 'dislike',
          content: '',
        })
      }
    },
  )
})

it.each(['false', 'reject'] as const)(
  'keeps the pending feedback focused and retries the draft after a %s failure',
  async (failure) => {
    let resolveFeedback!: (value: boolean) => void
    let rejectFeedback!: (reason: Error) => void
    feedback.onFeedback
      .mockReset()
      .mockReturnValueOnce(
        new Promise<boolean>((resolve, reject) => {
          resolveFeedback = resolve
          rejectFeedback = reject
        }),
      )
      .mockResolvedValue(undefined)
    const screen = await render(<FeedbackAnswer />)
    await screen.getByRole('article', { name: 'Answer' }).hover()
    const trigger = screen.getByRole('button', {
      name: 'appLog.table.header.userRate: appLog.detail.operation.dislike',
    })
    await trigger.click()
    const dialog = screen.getByRole('dialog', { name: 'common.feedback.title' })
    const textbox = dialog.getByRole('textbox', { name: 'common.feedback.content' })
    await textbox.fill('Please explain')
    await userEvent.keyboard('{End}{Enter}the answer')
    const draft = 'Please explain\nthe answer'
    await expect.element(textbox).toHaveValue(draft)
    expect(feedback.onFeedback).not.toHaveBeenCalled()

    const submit = dialog.getByRole('button', { name: 'common.operation.submit' })
    await submit.click()
    await expect.element(submit).toHaveFocus()
    await expect.element(submit).toHaveAttribute('aria-disabled', 'true')
    await expect.element(textbox).toHaveAttribute('readonly')
    await expect
      .element(dialog.getByRole('button', { name: 'common.operation.close' }))
      .toBeDisabled()
    await expect
      .element(dialog.getByRole('button', { name: 'common.operation.cancel' }))
      .toBeDisabled()
    await userEvent.keyboard('{Enter}{Enter}{Escape}')
    await expect.element(dialog).toBeVisible()
    expect(feedback.onFeedback).toHaveBeenCalledTimes(1)
    expect(feedback.onFeedback).toHaveBeenCalledWith('answer', {
      rating: 'dislike',
      content: draft,
    })

    const outside = document.elementFromPoint(4, 4)!
    await userEvent.click(outside, { position: { x: 4, y: 4 } })
    await expect.element(dialog).toBeVisible()
    await userEvent.tab()
    await expect.poll(() => dialog.element().contains(document.activeElement)).toBe(true)
    await textbox.click()
    await userEvent.keyboard('ignored')
    await expect.element(textbox).toHaveValue(draft)

    if (failure === 'false') resolveFeedback(false)
    else rejectFeedback(new Error('Feedback request failed'))
    await expect.element(textbox).not.toHaveAttribute('readonly')
    await expect.element(submit).not.toHaveAttribute('aria-disabled', 'true')
    await expect.element(dialog).toBeVisible()
    await expect.element(textbox).toHaveValue(draft)
    await submit.click()
    await expect.element(dialog).not.toBeInTheDocument()
    await expect.element(trigger).toHaveFocus()
    await expect.element(trigger).toHaveAttribute('aria-pressed', 'true')
    expect(feedback.onFeedback).toHaveBeenCalledTimes(2)
    expect(feedback.onFeedback).toHaveBeenLastCalledWith('answer', {
      rating: 'dislike',
      content: draft,
    })
  },
)
