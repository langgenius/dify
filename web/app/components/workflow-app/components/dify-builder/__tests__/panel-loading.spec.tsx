import type { ResourceKey } from 'i18next'
import type { ConversationItem, SessionView } from '../types'
import { act, screen, waitFor, within } from '@testing-library/react'
import { createStore, Provider } from 'jotai'
import { queryClientAtom } from 'jotai-tanstack-query'
import dynamic from 'next/dist/shared/lib/app-dynamic'
import { I18nClientProvider } from '@/app/components/provider/i18n'
import englishCommon from '@/i18n/locales/en-US/common.json'
import englishWorkflowAgent from '@/i18n/locales/en-US/workflow-agent.json'
import englishWorkflow from '@/i18n/locales/en-US/workflow.json'
import chineseCommon from '@/i18n/locales/zh-Hans/common.json'
import chineseWorkflowAgent from '@/i18n/locales/zh-Hans/workflow-agent.json'
import chineseWorkflow from '@/i18n/locales/zh-Hans/workflow.json'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import DifyBuilderPanel from '../panel'
import { difyBuilderConversationAtom, difyBuilderSessionViewAtom } from '../session/state'

vi.unmock('react-i18next')

const mocks = vi.hoisted(() => ({
  closePanel: vi.fn(),
  loadResource: vi.fn(),
}))

vi.mock('@/i18n/load-resource', () => ({ loadI18nResource: mocks.loadResource }))

vi.mock('../model-selector', () => ({
  default: () => <button type="button">Model selector</button>,
}))

vi.mock('../use-dify-builder-model', () => ({
  useDifyBuilderModel: () => ({
    model: { completion_params: {}, mode: 'chat', name: 'gpt-4o', provider: 'openai' },
    isLoading: false,
    isError: false,
    hasAvailableModels: true,
  }),
}))

vi.mock('@/app/components/workflow/store', () => ({
  useStore: <T,>(
    selector: (state: {
      setShowDifyBuilderPanel: typeof mocks.closePanel
      fileUploadConfig?: undefined
    }) => T,
  ) => selector({ setShowDifyBuilderPanel: mocks.closePanel }),
}))

// The default test resolver uses Pages Router dynamic; the editor uses App Router dynamic.
const DynamicDifyBuilderPanel = dynamic(() => Promise.resolve({ default: DifyBuilderPanel }), {
  ssr: false,
})

const translations = {
  'en-US': {
    common: englishCommon,
    workflow: englishWorkflow,
    workflowAgent: englishWorkflowAgent,
  },
  'zh-Hans': {
    common: chineseCommon,
    workflow: chineseWorkflow,
    workflowAgent: chineseWorkflowAgent,
  },
}

const initialView: SessionView = {
  actions: [],
  active_interaction: null,
  app_revision: { current: 'hash-1', conflicted: false },
  canvas_read_only: false,
  conversation_last_seq: 0,
  interrupted: false,
  phase: 'understand',
  run_status: 'processing',
  reply_language: '',
  session_id: 'session-1',
  version: 1,
}

const userMessage: ConversationItem = {
  seq: 0,
  at_version: 1,
  kind: 'user',
  payload: { text: 'Translate documents', turn_id: 'user-turn-1' },
}

const requirements: Extract<ConversationItem, { kind: 'form' }> = {
  seq: 1,
  at_version: 2,
  kind: 'form',
  payload: {
    variant: 'build_requirements',
    title: 'Review the requirements',
    fields: [{ key: 'goal', label: 'Goal', type: 'textarea', required: true }],
    values: { goal: 'Translate documents' },
  },
}

const renderPanel = (locale: keyof typeof translations, cached = false) => {
  const store = createStore()
  const queryClient = createConsoleQueryClient()
  store.set(queryClientAtom, queryClient)
  store.set(difyBuilderSessionViewAtom, initialView)
  store.set(difyBuilderConversationAtom, [userMessage])
  renderWithConsoleQuery(
    <Provider store={store}>
      <I18nClientProvider
        locale={locale}
        resource={Object.fromEntries(
          Object.entries(translations).map(([language, resources]) => [
            language,
            cached ? resources : { common: resources.common, workflow: resources.workflow },
          ]),
        )}
      >
        <DynamicDifyBuilderPanel />
      </I18nClientProvider>
    </Provider>,
    { queryClient },
  )
  return store
}

const showRequirements = (store: ReturnType<typeof createStore>) => {
  act(() => {
    store.set(difyBuilderConversationAtom, [userMessage, requirements])
    store.set(difyBuilderSessionViewAtom, {
      ...initialView,
      actions: [{ id: 'submit_requirements', label: 'Submit', kind: 'primary' }],
      active_interaction: {
        action_id: 'submit_requirements',
        card_seq: requirements.seq,
        valid_at_version: 2,
      },
      conversation_last_seq: requirements.seq,
      run_status: 'waiting_input',
      version: 2,
    })
  })
}

describe('DifyBuilderPanel translation loading', () => {
  beforeEach(() => {
    mocks.loadResource.mockReset()
  })

  it.each(['en-US', 'zh-Hans'] as const)(
    'keeps the panel and conversation visible while the %s requirements translations load',
    async (locale) => {
      let finishLoading!: () => void
      const pending = new Promise<void>((resolve) => {
        finishLoading = resolve
      })
      mocks.loadResource.mockImplementation(
        async (
          language: keyof typeof translations,
          namespace: string,
        ): Promise<{ default: ResourceKey }> => {
          if (namespace !== 'workflowAgent') throw new Error(`Unexpected namespace: ${namespace}`)
          await pending
          return { default: translations[language].workflowAgent }
        },
      )
      const store = renderPanel(locale)
      const copy = translations[locale]
      expect(
        await screen.findByRole('complementary', { name: copy.workflow['difyBuilder.panelTitle'] }),
      ).toBeVisible()
      expect(mocks.loadResource).not.toHaveBeenCalled()

      showRequirements(store)

      await waitFor(() => expect(mocks.loadResource).toHaveBeenCalledWith(locale, 'workflowAgent'))
      expect(
        screen.getByRole('complementary', { name: copy.workflow['difyBuilder.panelTitle'] }),
      ).toBeVisible()
      expect(
        screen.getByRole('heading', { name: copy.workflow['difyBuilder.panelTitle'] }),
      ).toBeVisible()
      const log = screen.getByRole('log', { name: copy.workflow['difyBuilder.panelTitle'] })
      expect(within(log).getByText('Translate documents')).toBeVisible()
      expect(screen.getByRole('status', { name: copy.common.loading })).toBeVisible()
      expect(screen.queryByRole('textbox', { name: 'Goal' })).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: copy.common['operation.close'] })).toBeEnabled()
      expect(mocks.closePanel).not.toHaveBeenCalled()

      await act(async () => {
        finishLoading()
        await pending
      })

      expect(await screen.findByRole('textbox', { name: 'Goal' })).toHaveValue(
        'Translate documents',
      )
      expect(
        screen.getByRole('complementary', { name: copy.workflow['difyBuilder.panelTitle'] }),
      ).toBeVisible()
      expect(within(log).getByText('Translate documents')).toBeVisible()
      expect(screen.queryByRole('status', { name: copy.common.loading })).not.toBeInTheDocument()
      expect(mocks.closePanel).not.toHaveBeenCalled()
    },
  )

  it('shows cached requirements immediately without replacing the panel with a loading state', async () => {
    const store = renderPanel('en-US', true)
    await screen.findByRole('complementary', { name: englishWorkflow['difyBuilder.panelTitle'] })

    showRequirements(store)

    expect(screen.getByRole('textbox', { name: 'Goal' })).toHaveValue('Translate documents')
    expect(
      screen.getByRole('complementary', { name: englishWorkflow['difyBuilder.panelTitle'] }),
    ).toBeVisible()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(mocks.loadResource).not.toHaveBeenCalled()
    expect(mocks.closePanel).not.toHaveBeenCalled()
  })
})
