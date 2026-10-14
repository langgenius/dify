import type { ConversationItem, SessionView } from '../types'
import { act, screen } from '@testing-library/react'
import { createStore, Provider } from 'jotai'
import { queryClientAtom } from 'jotai-tanstack-query'
import dynamic from 'next/dist/shared/lib/app-dynamic'
import { I18nClientProvider } from '@/app/components/provider/i18n'
import englishCommon from '@/i18n/locales/en-US/common.json'
import englishBuilder from '@/i18n/locales/en-US/dify-builder.json'
import englishWorkflowAgent from '@/i18n/locales/en-US/workflow-agent.json'
import englishWorkflow from '@/i18n/locales/en-US/workflow.json'
import chineseCommon from '@/i18n/locales/zh-Hans/common.json'
import chineseBuilder from '@/i18n/locales/zh-Hans/dify-builder.json'
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
    difyBuilder: englishBuilder,
    workflowAgent: englishWorkflowAgent,
  },
  'zh-Hans': {
    common: chineseCommon,
    workflow: chineseWorkflow,
    difyBuilder: chineseBuilder,
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
            cached
              ? resources
              : {
                  common: resources.common,
                  workflow: resources.workflow,
                  difyBuilder: resources.difyBuilder,
                },
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
    'renders %s requirements from Builder resources without loading workflow translations',
    async (locale) => {
      const store = renderPanel(locale)
      const copy = translations[locale]
      await screen.findByRole('complementary', { name: copy.difyBuilder.panelTitle })
      showRequirements(store)
      expect(await screen.findByRole('textbox', { name: 'Goal' })).toHaveValue(
        'Translate documents',
      )
      expect(screen.queryByRole('status', { name: copy.common.loading })).not.toBeInTheDocument()
      expect(mocks.loadResource).not.toHaveBeenCalled()
      expect(mocks.closePanel).not.toHaveBeenCalled()
    },
  )

  it('shows cached requirements immediately without replacing the panel with a loading state', async () => {
    const store = renderPanel('en-US', true)
    await screen.findByRole('complementary', { name: englishBuilder.panelTitle })

    showRequirements(store)

    expect(screen.getByRole('textbox', { name: 'Goal' })).toHaveValue('Translate documents')
    expect(screen.getByRole('complementary', { name: englishBuilder.panelTitle })).toBeVisible()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(mocks.loadResource).not.toHaveBeenCalled()
    expect(mocks.closePanel).not.toHaveBeenCalled()
  })
})
