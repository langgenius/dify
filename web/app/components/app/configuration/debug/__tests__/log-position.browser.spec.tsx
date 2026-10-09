import type { Ref } from 'react'
import type { ChatItem } from '@/app/components/base/chat/types'
import { page } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import Chat from '@/app/components/base/chat/chat'
import { FeaturesProvider } from '@/app/components/base/features/context'
import ConfigContext, { useDebugConfigurationContext } from '@/context/debug-configuration'
import Debug from '../index'

vi.mock('@tanstack/react-query', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-query')>()),
  useQuery: () => ({ data: [] }),
}))
vi.mock('@/app/components/header/account-setting/model-provider-page/hooks', () => ({
  useDefaultModel: () => ({ data: undefined }),
}))
vi.mock('@/context/event-emitter', () => ({
  useEventEmitterContextContext: () => ({}),
}))
vi.mock('@/app/components/app/configuration/debug/chat-user-input', () => ({ default: () => null }))
vi.mock('@/app/components/app/configuration/prompt-value-panel', () => ({ default: () => null }))
vi.mock('../debug-with-multiple-model', () => ({ default: () => null }))
vi.mock('@/app/components/base/agent-log-modal', () => ({ default: () => null }))
vi.mock('@/app/components/app/text-generate/item', () => ({ default: () => null }))
vi.mock('@/service/debug', () => ({ sendCompletionMessage: vi.fn() }))
vi.mock('@/app/components/app/configuration/toast', () => ({ toast: { error: vi.fn() } }))

// Replace model execution, keeping the production Chat scroll container and log action path.
vi.mock('../debug-with-single-model', () => ({
  default: ({
    onOpenLog,
    chatContainerRef,
  }: {
    onOpenLog: (item: ChatItem) => void
    chatContainerRef: Ref<HTMLDivElement>
  }) => (
    <Chat
      chatList={[
        {
          id: 'answer',
          isAnswer: true,
          content: 'Answer',
          log: [{ role: 'user', text: 'Measured prompt' }],
        },
      ]}
      onOpenLog={onOpenLog}
      chatContainerRef={chatContainerRef}
      chatContainerClassName="debug-log-scrollbar"
      noChatInput
    />
  ),
}))
vi.mock('@/app/components/base/chat/chat/answer', async () => {
  const { default: Operation } = await import('@/app/components/base/chat/chat/answer/operation')
  return {
    default: ({ item }: { item: ChatItem }) => (
      <div className="group">
        <div style={{ height: 900 }}>{item.content}</div>
        <Operation
          item={item}
          question=""
          index={0}
          maxSize={500}
          contentWidth={100}
          hasWorkflowProcess={false}
        />
      </div>
    ),
  }
})
vi.mock('@/app/components/base/chat/chat/question', () => ({ default: () => null }))
vi.mock('@/app/components/base/chat/chat/chat-input-area', () => ({ default: () => null }))
vi.mock('@/app/components/base/new-audio-button', () => ({ default: () => null }))
vi.mock('@/app/components/app/annotation/edit-annotation-modal', () => ({ default: () => null }))
vi.mock(
  '@/app/components/base/features/new-feature-panel/annotation-reply/annotation-ctrl-button',
  () => ({ default: () => null }),
)

function DebugSession({ width, doubleGutter = false }: { width: number; doubleGutter?: boolean }) {
  const defaults = useDebugConfigurationContext()
  return (
    // oxlint-disable-next-line eslint-react/no-context-provider -- use-context-selector exposes a Provider, not a React 19 provider component.
    <ConfigContext.Provider
      value={{
        ...defaults,
        canTestAndRun: true,
        modelConfig: {
          ...defaults.modelConfig,
          configs: { prompt_template: '', prompt_variables: [] },
        },
      }}
    >
      <FeaturesProvider>
        <style>{`.debug-log-scrollbar { scrollbar-gutter: stable; } .debug-log-scrollbar::-webkit-scrollbar { width: 16px; } .debug-double-gutter .debug-log-scrollbar { scrollbar-gutter: stable both-edges; }`}</style>
        <section
          aria-label="Debug pane"
          className={doubleGutter ? 'debug-double-gutter' : undefined}
          style={{
            position: 'fixed',
            top: 64,
            right: 8,
            bottom: 16,
            width,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <Debug
            isPreview
            onSetting={vi.fn()}
            inputs={{}}
            modelParameterParams={{ setModel: vi.fn(), onCompletionParamsChange: vi.fn() }}
            debugWithMultipleModel={false}
            multipleModelConfigs={[]}
            onMultipleModelConfigsChange={vi.fn()}
          />
        </section>
      </FeaturesProvider>
    </ConfigContext.Provider>
  )
}

it('keeps the log beside the actual scrolling chat after resizing its pane', async () => {
  await page.viewport(1440, 900)
  const view = await render(<DebugSession width={540} />)
  const chat = page.getByTestId('chat-container').element()
  expect(chat.scrollHeight).toBeGreaterThan(chat.clientHeight)
  expect(chat.clientWidth).toBeLessThan(chat.getBoundingClientRect().width)

  await page.getByText('Answer', { exact: true }).hover()
  await page.getByRole('button', { name: 'common.operation.log' }).click()
  await expect.element(page.getByText('Measured prompt')).toBeVisible()
  const title = page.getByText('PROMPT LOG').element()
  const initialTitleLeft = title.getBoundingClientRect().left
  const initialChatWidth = chat.clientWidth
  expect(title.getBoundingClientRect().right).toBeLessThan(chat.getBoundingClientRect().left)

  await view.rerender(<DebugSession width={540} doubleGutter />)
  await expect.poll(() => chat.clientWidth).toBeLessThan(initialChatWidth)
  await expect
    .poll(() => title.getBoundingClientRect().left - initialTitleLeft)
    .toBe(initialChatWidth - chat.clientWidth)

  await view.rerender(<DebugSession width={420} doubleGutter />)
  await expect
    .poll(() => title.getBoundingClientRect().left - initialTitleLeft)
    .toBe(initialChatWidth - chat.clientWidth)
  expect(title.getBoundingClientRect().right).toBeLessThan(chat.getBoundingClientRect().left)
  await expect.element(page.getByText('Measured prompt')).toBeVisible()
  await page.getByRole('button', { name: 'common.operation.close' }).click()
  await expect.element(page.getByText('Measured prompt')).not.toBeInTheDocument()
  await page.getByText('Answer', { exact: true }).hover()
  await page.getByRole('button', { name: 'common.operation.log' }).click()
  await expect.element(page.getByText('Measured prompt')).toBeVisible()
})
