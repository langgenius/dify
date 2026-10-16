import type { ConversationItem } from '../types'
import { render, screen, within } from '@testing-library/react'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import english from '@/i18n/locales/en-US/dify-builder.json'
import chinese from '@/i18n/locales/zh-Hans/dify-builder.json'
import { DifyBuilderConversation } from '../conversation'
import {
  DifyBuilderLocaleContext,
  DifyBuilderReplyLocaleContext,
} from '../interactions/locale-context'

vi.mock('react-i18next', async () => vi.importActual('react-i18next'))
vi.mock('@/app/components/base/markdown', () => ({
  Markdown: ({ content }: { content: string }) => <p>{content}</p>,
}))

const instance = createInstance()
const replies = {
  readyLocales: new Set(['en-US', 'zh-Hans'] as const),
  preloadLocale: () => () => {},
}
const history: ConversationItem[] = [
  {
    seq: 0,
    at_version: 1,
    kind: 'plan',
    payload: {
      title: '前一版计划',
      items: ['读取文档'],
      input_summary: '原始文档。',
      output_summary: '原始报告。',
      reply_language: 'zh-Hans',
    },
  },
  {
    seq: 1,
    at_version: 1,
    kind: 'assistant_turn',
    payload: {
      turn_id: 'old',
      stage_id: 'edit.plan_approval',
      execution: { status: 'completed' },
      cards: ['plan'],
      card_state: 'invalidated',
      reply_mode: 'complete',
    },
  },
  {
    seq: 2,
    at_version: 2,
    kind: 'plan',
    payload: {
      title: 'Updated plan',
      items: ['Read documents', 'Return summary'],
      reply_language: 'en-US',
      input_summary: 'Source documents.',
      output_summary: 'A summary report.',
    },
  },
]

const conversation = (items: ConversationItem[], locale: 'en-US' | 'zh-Hans' = 'en-US') => (
  <I18nextProvider i18n={instance}>
    <DifyBuilderLocaleContext value={locale}>
      <DifyBuilderReplyLocaleContext value={replies}>
        <DifyBuilderConversation busy={false} interrupted={false} items={items} />
      </DifyBuilderReplyLocaleContext>
    </DifyBuilderLocaleContext>
  </I18nextProvider>
)

beforeAll(async () => {
  await instance.init({
    lng: 'en-US',
    fallbackLng: 'en-US',
    keySeparator: false,
    interpolation: { escapeValue: false },
    resources: { 'en-US': { difyBuilder: english }, 'zh-Hans': { difyBuilder: chinese } },
  })
})

it('preserves each plan overview and reply language across replanning and language changes', () => {
  const { rerender } = render(conversation(history.slice(0, 2)))
  const previousCard = screen.getByRole('article', { name: '计划' })
  expect(within(previousCard).getByRole('heading', { name: '前一版计划' })).toBeInTheDocument()
  expect(within(previousCard).getByRole('listitem')).toHaveTextContent('读取文档')
  expect(previousCard).toHaveTextContent('1 步')
  expect(
    within(previousCard)
      .getAllByRole('term')
      .map((term) => term.textContent),
  ).toEqual(['输入', '输出'])
  expect(previousCard).toHaveTextContent('原始文档。')
  expect(previousCard).toHaveTextContent('原始报告。')
  expect(within(previousCard).queryByText('已就绪')).not.toBeInTheDocument()
  rerender(conversation(history))
  const newCard = screen.getByRole('article', { name: 'Plan' })
  expect(
    within(newCard)
      .getAllByRole('term')
      .map((term) => term.textContent),
  ).toEqual(['Input', 'Output'])
  expect(newCard).toHaveTextContent('Source documents.')
  expect(newCard).toHaveTextContent('A summary report.')
  expect(newCard).toHaveTextContent('2 steps')
  expect(within(newCard).getByText('ready')).toBeInTheDocument()
  rerender(conversation(history, 'zh-Hans'))
  expect(screen.getByRole('article', { name: 'Plan' })).toHaveTextContent('2 steps')
  expect(screen.getByRole('article', { name: '计划' })).toHaveTextContent('1 步')
  expect(screen.getByRole('article', { name: '计划' })).toHaveTextContent('原始文档。')
  expect(screen.getByRole('article', { name: '计划' })).toHaveTextContent('原始报告。')
})
