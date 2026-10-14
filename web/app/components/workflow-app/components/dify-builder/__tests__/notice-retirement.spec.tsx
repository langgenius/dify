import type { ConversationItem } from '../types'
import type { MarkdownProps } from '@/app/components/base/markdown'
import { render, screen, within } from '@testing-library/react'
import { createStore, Provider } from 'jotai'
import { Suspense } from 'react'
import { I18nClientProvider } from '@/app/components/provider/i18n'
import chineseBuilder from '@/i18n/locales/zh-Hans/dify-builder.json'
import { DifyBuilderConversation } from '../conversation'
import { createSessionView } from '../session/__tests__/fixtures'
import { difyBuilderSessionViewAtom } from '../session/state'

vi.unmock('react-i18next')
vi.mock('@/app/components/base/markdown', () => ({
  Markdown: ({ content }: MarkdownProps) => <p>{content}</p>,
}))
vi.mock('@/app/components/workflow/store', () => ({
  useStore: <T,>(selector: (state: { fileUploadConfig?: undefined }) => T) =>
    selector({ fileUploadConfig: undefined }),
}))

it('hides legacy notices while preserving literal receipts and showing the complete localized reply', async () => {
  const store = createStore()
  store.set(difyBuilderSessionViewAtom, createSessionView({ reply_language: 'zh-Hans' }))
  const items: ConversationItem[] = [
    { kind: 'notice', seq: 0, at_version: 1, payload: { text: 'Legacy recovery explanation' } },
    {
      kind: 'notice',
      seq: 1,
      at_version: 1,
      payload: {
        reply_language: 'en',
        text: { type: 'copy', id: 'model.changed', params: { name: 'old-model' } },
      },
    },
    {
      kind: 'interaction_response',
      seq: 2,
      at_version: 2,
      payload: {
        interaction_kind: 'form',
        question: '以前の入力',
        fields: [
          {
            key: 'goal',
            label: 'Goal',
            value: 'Yes {{name}} <tag>',
            display_value: 'Yes {{name}} <tag>',
          },
          { key: 'enabled', label: 'Enabled', value: false, display_value: 'No' },
          { key: 'count', label: 'Count', value: 0, display_value: '0' },
        ],
        submitted_data: { goal: 'Yes {{name}} <tag>', enabled: false, count: 0 },
      },
    },
    {
      kind: 'assistant_turn',
      seq: 3,
      at_version: 3,
      payload: {
        turn_id: 'new-reply',
        reply_language: 'zh-Hans',
        reply_mode: 'complete',
        execution: { status: 'completed' },
        reply_text: { type: 'copy', id: 'replies.noFixIsStagedForThisFailureKeepTheDraftOrRevert' },
      },
    },
    {
      kind: 'assistant_turn',
      seq: 4,
      at_version: 4,
      payload: {
        turn_id: 'dynamic-reply',
        reply_language: 'en',
        execution: { status: 'completed' },
        reply_text: 'Original dynamic reply {{name}} <tag>',
      },
    },
  ]
  render(
    <I18nClientProvider locale="en-US" resource={{}}>
      <Provider store={store}>
        <Suspense fallback={<p>Loading translations</p>}>
          <DifyBuilderConversation busy={false} interrupted={false} items={items} />
        </Suspense>
      </Provider>
    </I18nClientProvider>,
  )

  const log = await screen.findByRole('log', { name: chineseBuilder.panelTitle })
  expect(within(log).queryByText('Legacy recovery explanation')).not.toBeInTheDocument()
  expect(within(log).queryByText(/old-model/)).not.toBeInTheDocument()
  expect(within(log).getByRole('heading', { name: '以前の入力' })).toBeVisible()
  expect(within(log).getByRole('textbox', { name: 'Goal' })).toHaveValue('Yes {{name}} <tag>')
  expect(within(log).getByRole('checkbox', { name: 'Enabled' })).not.toBeChecked()
  expect(within(log).getByRole('textbox', { name: 'Count' })).toHaveValue('0')
  expect(
    within(log).getByText(
      chineseBuilder['copy.replies.noFixIsStagedForThisFailureKeepTheDraftOrRevert'],
    ),
  ).toBeVisible()
  expect(within(log).getByText('Original dynamic reply {{name}} <tag>')).toBeVisible()
})
