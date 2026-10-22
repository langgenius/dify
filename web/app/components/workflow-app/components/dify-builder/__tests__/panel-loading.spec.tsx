import type { ConversationItem, DifyBuilderExecutionProgress, SessionView } from '../types'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createStore, Provider } from 'jotai'
import { queryClientAtom } from 'jotai-tanstack-query'
import dynamic from 'next/dist/shared/lib/app-dynamic'
import { I18nClientProvider } from '@/app/components/provider/i18n'
import englishCommon from '@/i18n/locales/en-US/common.json'
import englishBuilder from '@/i18n/locales/en-US/dify-builder.json'
import englishWorkflowAgent from '@/i18n/locales/en-US/workflow-agent.json'
import englishWorkflow from '@/i18n/locales/en-US/workflow.json'
import frenchCommon from '@/i18n/locales/fr-FR/common.json'
import frenchBuilder from '@/i18n/locales/fr-FR/dify-builder.json'
import frenchWorkflowAgent from '@/i18n/locales/fr-FR/workflow-agent.json'
import frenchWorkflow from '@/i18n/locales/fr-FR/workflow.json'
import chineseCommon from '@/i18n/locales/zh-Hans/common.json'
import chineseBuilder from '@/i18n/locales/zh-Hans/dify-builder.json'
import chineseWorkflowAgent from '@/i18n/locales/zh-Hans/workflow-agent.json'
import chineseWorkflow from '@/i18n/locales/zh-Hans/workflow.json'
import { createConsoleQueryClient, renderWithConsoleQuery } from '@/test/console/query-data'
import DifyBuilderPanel from '../panel'
import {
  difyBuilderConversationAtom,
  difyBuilderExecutionProgressAtom,
  difyBuilderSessionViewAtom,
} from '../session/state'

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
  'fr-FR': {
    common: frenchCommon,
    workflow: frenchWorkflow,
    difyBuilder: frenchBuilder,
    workflowAgent: frenchWorkflowAgent,
  },
}

const deferTranslationLoading = () => {
  let resolveTranslations!: () => void
  const loaded = new Promise<void>((resolve) => {
    resolveTranslations = resolve
  })
  mocks.loadResource.mockImplementation(
    async (locale: keyof typeof translations, namespace: keyof (typeof translations)['en-US']) => {
      await loaded
      return { default: translations[locale][namespace] }
    },
  )
  return resolveTranslations
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

const progress: DifyBuilderExecutionProgress = {
  sessionId: initialView.session_id,
  operationId: 'operation-1',
  atVersion: 2,
  revision: 1,
  replyLanguage: 'en',
  execution: {
    status: 'running',
    activities: [
      {
        id: 'understand-goal',
        label: { type: 'copy', id: 'progress.understandTheRequestedWorkflow' },
        state: 'active',
      },
    ],
  },
}

const renderPanel = async (
  locale: keyof typeof translations,
  { cached = false, preloadReplyLocale = true } = {},
) => {
  const store = createStore()
  const queryClient = createConsoleQueryClient()
  store.set(queryClientAtom, queryClient)
  store.set(difyBuilderSessionViewAtom, initialView)
  store.set(difyBuilderConversationAtom, [userMessage])
  // Flush the App Router's initial lazy render before testing later translation loads.
  await act(async () => {
    renderWithConsoleQuery(
      <Provider store={store}>
        <I18nClientProvider
          locale={locale}
          resource={Object.fromEntries(
            Object.entries(translations)
              .filter(([language]) => preloadReplyLocale || language === locale)
              .map(([language, resources]) => [
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
  })
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
      const store = await renderPanel(locale)
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
    const store = await renderPanel('en-US', { cached: true })
    await screen.findByRole('complementary', { name: englishBuilder.panelTitle })

    showRequirements(store)

    expect(screen.getByRole('textbox', { name: 'Goal' })).toHaveValue('Translate documents')
    expect(screen.getByRole('complementary', { name: englishBuilder.panelTitle })).toBeVisible()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(mocks.loadResource).not.toHaveBeenCalled()
    expect(mocks.closePanel).not.toHaveBeenCalled()
  })

  it('keeps the panel and progress visible while loading the detected language', async () => {
    const resolveTranslations = deferTranslationLoading()
    const store = await renderPanel('en-US', { preloadReplyLocale: false })
    await screen.findByRole('complementary', { name: englishBuilder.panelTitle })
    act(() => store.set(difyBuilderExecutionProgressAtom, progress))
    await screen.findByText(englishBuilder['copy.progress.understandTheRequestedWorkflow'])

    act(() => {
      store.set(difyBuilderExecutionProgressAtom, { ...progress, replyLanguage: 'zh-Hans' })
    })
    await waitFor(() => expect(mocks.loadResource).toHaveBeenCalledWith('zh-Hans', 'difyBuilder'))

    expect(screen.getByRole('complementary', { name: englishBuilder.panelTitle })).toBeVisible()
    expect(screen.getByRole('button', { name: englishCommon['operation.close'] })).toBeVisible()
    expect(
      screen.getByText(englishBuilder['copy.progress.understandTheRequestedWorkflow']),
    ).toBeVisible()

    await act(async () => resolveTranslations())

    expect(
      await screen.findByRole('button', { name: chineseCommon['operation.close'] }),
    ).toBeVisible()
    expect(
      await screen.findByText(chineseBuilder['copy.progress.understandTheRequestedWorkflow']),
    ).toBeVisible()
    expect(mocks.closePanel).not.toHaveBeenCalled()
  })

  it('keeps requirement drafts editable while loading the session language', async () => {
    const user = userEvent.setup()
    const resolveTranslations = deferTranslationLoading()
    const store = await renderPanel('en-US', { preloadReplyLocale: false })
    await screen.findByRole('complementary', { name: englishBuilder.panelTitle })
    showRequirements(store)
    const input = await screen.findByRole('textbox', { name: 'Goal' })
    await user.clear(input)
    await user.type(input, 'Edited goal')

    act(() => {
      store.set(difyBuilderSessionViewAtom, (view) => ({ ...view!, reply_language: 'zh-Hans' }))
    })
    await waitFor(() => expect(mocks.loadResource).toHaveBeenCalledWith('zh-Hans', 'difyBuilder'))

    expect(screen.getByRole('complementary', { name: englishBuilder.panelTitle })).toBeVisible()
    expect(screen.getByRole('textbox', { name: 'Goal' })).toHaveValue('Edited goal')
    await user.type(input, ' while loading')

    await act(async () => resolveTranslations())

    expect(
      await screen.findByRole('button', { name: chineseCommon['operation.close'] }),
    ).toBeVisible()
    expect(screen.getByRole('textbox', { name: 'Goal' })).toHaveValue('Edited goal while loading')
    expect(mocks.closePanel).not.toHaveBeenCalled()
  })

  it('renders newly arriving progress and requirements without a translation loading state', async () => {
    const user = userEvent.setup()
    const resolveTranslations = deferTranslationLoading()
    const store = await renderPanel('en-US', { preloadReplyLocale: false })
    await screen.findByRole('complementary', { name: englishBuilder.panelTitle })

    act(() => {
      store.set(difyBuilderExecutionProgressAtom, { ...progress, replyLanguage: 'zh-Hans' })
    })
    await waitFor(() => expect(mocks.loadResource).toHaveBeenCalledWith('zh-Hans', 'difyBuilder'))

    expect(screen.getByText('Translate documents')).toBeVisible()
    expect(
      screen.getByText(englishBuilder['copy.progress.understandTheRequestedWorkflow']),
    ).toBeVisible()
    expect(screen.queryByRole('status', { name: englishCommon.loading })).not.toBeInTheDocument()

    showRequirements(store)
    const input = screen.getByRole('textbox', { name: 'Goal' })
    expect(input).toHaveValue('Translate documents')
    expect(screen.queryByRole('status', { name: englishCommon.loading })).not.toBeInTheDocument()
    await user.type(input, ' while loading')

    await act(async () => resolveTranslations())

    expect(
      await screen.findByRole('button', { name: chineseCommon['operation.close'] }),
    ).toBeVisible()
    expect(screen.getByRole('textbox', { name: 'Goal' })).toHaveValue(
      'Translate documents while loading',
    )
    expect(screen.queryByRole('status', { name: chineseCommon.loading })).not.toBeInTheDocument()
  })

  it('keeps the current language until all panel translations have loaded', async () => {
    let resolveBuilder!: () => void
    let resolveCommon!: () => void
    const builderLoaded = new Promise<void>((resolve) => {
      resolveBuilder = resolve
    })
    const commonLoaded = new Promise<void>((resolve) => {
      resolveCommon = resolve
    })
    mocks.loadResource.mockImplementation(
      async (
        locale: keyof typeof translations,
        namespace: keyof (typeof translations)['en-US'],
      ) => {
        if (namespace === 'difyBuilder') await builderLoaded
        if (namespace === 'common') await commonLoaded
        return { default: translations[locale][namespace] }
      },
    )
    const store = await renderPanel('en-US', { preloadReplyLocale: false })
    await screen.findByRole('complementary', { name: englishBuilder.panelTitle })

    act(() => {
      store.set(difyBuilderExecutionProgressAtom, { ...progress, replyLanguage: 'zh-Hans' })
    })
    await waitFor(() => expect(mocks.loadResource).toHaveBeenCalledWith('zh-Hans', 'common'))
    await act(async () => resolveBuilder())
    showRequirements(store)

    expect(screen.getByRole('button', { name: englishCommon['operation.close'] })).toBeVisible()
    expect(screen.getByRole('textbox', { name: 'Goal' })).toHaveValue('Translate documents')
    expect(
      screen.getByText(englishBuilder['copy.progress.understandTheRequestedWorkflow']),
    ).toBeVisible()
    expect(screen.queryByRole('status', { name: englishCommon.loading })).not.toBeInTheDocument()

    await act(async () => resolveCommon())

    expect(
      await screen.findByRole('button', { name: chineseCommon['operation.close'] }),
    ).toBeVisible()
    expect(
      await screen.findByText(chineseBuilder['copy.progress.understandTheRequestedWorkflow']),
    ).toBeVisible()
    expect(screen.getByRole('textbox', { name: 'Goal' })).toHaveValue('Translate documents')
  })

  it.each(['decision', 'form'] as const)(
    'uses the last ready panel language when a %s first appears during consecutive language changes',
    async (interaction) => {
      const user = userEvent.setup()
      const releases = new Map<string, () => void>()
      const pending = new Map(
        ['zh-Hans', 'fr-FR'].map((locale) => [
          locale,
          new Promise<void>((resolve) => releases.set(locale, resolve)),
        ]),
      )
      mocks.loadResource.mockImplementation(
        async (
          locale: keyof typeof translations,
          namespace: keyof (typeof translations)['en-US'],
        ) => {
          await pending.get(locale)
          return { default: translations[locale][namespace] }
        },
      )
      const store = await renderPanel('en-US', { preloadReplyLocale: false })
      const panel = await screen.findByRole('complementary', { name: englishBuilder.panelTitle })

      act(() => {
        store.set(difyBuilderSessionViewAtom, { ...initialView, reply_language: 'zh-Hans' })
      })
      await waitFor(() => expect(mocks.loadResource).toHaveBeenCalledWith('zh-Hans', 'difyBuilder'))
      await act(async () => releases.get('zh-Hans')!())
      await screen.findByRole('button', { name: chineseCommon['operation.close'] })

      act(() => {
        store.set(difyBuilderSessionViewAtom, { ...initialView, reply_language: 'fr' })
      })
      await waitFor(() => expect(mocks.loadResource).toHaveBeenCalledWith('fr-FR', 'difyBuilder'))
      act(() => {
        if (interaction === 'decision') {
          store.set(difyBuilderSessionViewAtom, {
            ...initialView,
            reply_language: 'fr',
            run_status: 'waiting_input',
            version: 2,
            decision: {
              title: { type: 'copy', id: 'labels.noRepairAvailable' },
              options: [
                {
                  id: 'retry_repair',
                  label: { type: 'copy', id: 'actions.tryAgain' },
                  input: { placeholder: 'Goal', required: true },
                },
              ],
            },
          })
        } else {
          store.set(difyBuilderConversationAtom, [
            userMessage,
            {
              ...requirements,
              payload: {
                ...requirements.payload,
                title: { type: 'copy', id: 'forms.requirements.title' },
              },
            },
          ])
          store.set(difyBuilderSessionViewAtom, {
            ...initialView,
            reply_language: 'fr',
            run_status: 'waiting_input',
            version: 2,
            active_interaction: {
              action_id: 'submit_requirements',
              card_seq: requirements.seq,
              valid_at_version: 2,
            },
          })
        }
      })

      const titleKey =
        interaction === 'decision'
          ? 'copy.labels.noRepairAvailable'
          : 'copy.forms.requirements.title'
      expect(screen.getByRole('region', { name: chineseBuilder[titleKey] })).toHaveAttribute(
        'lang',
        'zh-Hans',
      )
      expect(
        screen.getByRole('button', {
          name: chineseBuilder[
            interaction === 'decision' ? 'copy.actions.tryAgain' : 'copy.actions.submitRequirements'
          ],
        }),
      ).toBeVisible()
      const input = screen.getByRole('textbox', { name: 'Goal' })
      await user.clear(input)
      await user.type(input, 'Keep this draft')
      expect(screen.queryByRole('status')).not.toBeInTheDocument()

      await act(async () => releases.get('fr-FR')!())

      expect(await screen.findByRole('region', { name: frenchBuilder[titleKey] })).toHaveAttribute(
        'lang',
        'fr-FR',
      )
      expect(screen.getByRole('textbox', { name: 'Goal' })).toBe(input)
      expect(input).toHaveValue('Keep this draft')
      expect(input).toHaveFocus()
      expect(screen.getByRole('complementary', { name: frenchBuilder.panelTitle })).toBe(panel)
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
      expect(mocks.closePanel).not.toHaveBeenCalled()
    },
  )

  it.each(['latest-first', 'return-to-pending-language'] as const)(
    'ignores stale translation completions during consecutive language changes: %s',
    async (order) => {
      const user = userEvent.setup()
      const releases = new Map<string, () => void>()
      const pending = new Map(
        ['zh-Hans', 'fr-FR'].map((locale) => [
          locale,
          new Promise<void>((resolve) => releases.set(locale, resolve)),
        ]),
      )
      mocks.loadResource.mockImplementation(
        async (
          locale: keyof typeof translations,
          namespace: keyof (typeof translations)['en-US'],
        ) => {
          await pending.get(locale)
          return { default: translations[locale][namespace] }
        },
      )
      const store = await renderPanel('en-US', { preloadReplyLocale: false })
      const panel = await screen.findByRole('complementary', { name: englishBuilder.panelTitle })
      showRequirements(store)
      const input = screen.getByRole('textbox', { name: 'Goal' })
      await user.clear(input)
      await user.type(input, 'Draft survives out-of-order translations')

      const changeLanguage = (replyLanguage: string) => {
        act(() => {
          store.set(difyBuilderSessionViewAtom, (view) => ({
            ...view!,
            reply_language: replyLanguage,
          }))
        })
      }
      changeLanguage('zh-Hans')
      await waitFor(() => expect(mocks.loadResource).toHaveBeenCalledWith('zh-Hans', 'difyBuilder'))
      changeLanguage('fr')
      await waitFor(() => expect(mocks.loadResource).toHaveBeenCalledWith('fr-FR', 'difyBuilder'))
      if (order === 'return-to-pending-language') changeLanguage('zh-Hans')

      expect(screen.getByRole('button', { name: englishCommon['operation.close'] })).toBeVisible()
      expect(screen.getByRole('textbox', { name: 'Goal' })).toBe(input)
      expect(input).toHaveFocus()
      expect(screen.queryByRole('status')).not.toBeInTheDocument()

      await act(async () => releases.get('fr-FR')!())
      const intermediateCommon = order === 'latest-first' ? frenchCommon : englishCommon
      const intermediateBuilder = order === 'latest-first' ? frenchBuilder : englishBuilder
      expect(
        screen.getByRole('button', { name: intermediateCommon['operation.close'] }),
      ).toBeVisible()
      expect(
        screen.getByRole('button', {
          name: intermediateBuilder['copy.actions.submitRequirements'],
        }),
      ).toBeVisible()
      expect(input).toHaveValue('Draft survives out-of-order translations')
      expect(input).toHaveFocus()

      await act(async () => releases.get('zh-Hans')!())
      const finalCommon = order === 'latest-first' ? frenchCommon : chineseCommon
      const finalBuilder = order === 'latest-first' ? frenchBuilder : chineseBuilder
      expect(screen.getByRole('button', { name: finalCommon['operation.close'] })).toBeVisible()
      expect(
        screen.getByRole('button', { name: finalBuilder['copy.actions.submitRequirements'] }),
      ).toBeVisible()
      expect(screen.getByRole('complementary', { name: englishBuilder.panelTitle })).toBe(panel)
      expect(screen.getByRole('textbox', { name: 'Goal' })).toBe(input)
      expect(input).toHaveValue('Draft survives out-of-order translations')
      expect(input).toHaveFocus()
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
      expect(mocks.closePanel).not.toHaveBeenCalled()
      expect(
        mocks.loadResource.mock.calls.filter(
          ([locale, namespace]) => locale === 'zh-Hans' && namespace === 'difyBuilder',
        ),
      ).toHaveLength(1)
    },
  )

  it('loads historical reply copy without switching the displayed panel language', async () => {
    const user = userEvent.setup()
    let resolveChineseCommon!: () => void
    const chineseCommonLoaded = new Promise<void>((resolve) => {
      resolveChineseCommon = resolve
    })
    const releases = new Map<string, () => void>()
    const pending = new Map(
      ['zh-Hans', 'fr-FR'].map((locale) => [
        locale,
        new Promise<void>((resolve) => releases.set(locale, resolve)),
      ]),
    )
    mocks.loadResource.mockImplementation(
      async (
        locale: keyof typeof translations,
        namespace: keyof (typeof translations)['en-US'],
      ) => {
        await pending.get(locale)
        if (locale === 'zh-Hans' && namespace === 'common') await chineseCommonLoaded
        return { default: translations[locale][namespace] }
      },
    )
    const store = await renderPanel('en-US', { preloadReplyLocale: false })
    await screen.findByRole('complementary', { name: englishBuilder.panelTitle })
    showRequirements(store)
    const input = screen.getByRole('textbox', { name: 'Goal' })
    await user.type(input, ' keep editing')
    act(() => {
      store.set(difyBuilderSessionViewAtom, (view) => ({ ...view!, reply_language: 'fr' }))
      store.set(difyBuilderConversationAtom, (items) => [
        ...items,
        {
          seq: 2,
          at_version: 1,
          kind: 'interaction_response',
          payload: {
            interaction_kind: 'choice',
            reply_language: 'zh-Hans',
            question: { type: 'copy', id: 'labels.noRepairAvailable' },
            answer: { type: 'copy', id: 'actions.tryAgain' },
          },
        },
      ])
    })
    await waitFor(() => expect(mocks.loadResource).toHaveBeenCalledWith('fr-FR', 'common'))
    await waitFor(() => expect(mocks.loadResource).toHaveBeenCalledWith('zh-Hans', 'difyBuilder'))

    await act(async () => releases.get('zh-Hans')!())

    expect(
      screen.getByRole('heading', { name: chineseBuilder['copy.labels.noRepairAvailable'] }),
    ).toBeVisible()
    expect(screen.getByRole('button', { name: englishCommon['operation.close'] })).toBeVisible()
    expect(mocks.loadResource).not.toHaveBeenCalledWith('zh-Hans', 'common')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()

    await act(async () => releases.get('fr-FR')!())

    expect(screen.getByRole('button', { name: frenchCommon['operation.close'] })).toBeVisible()
    expect(
      screen.getByRole('heading', { name: chineseBuilder['copy.labels.noRepairAvailable'] }),
    ).toBeVisible()
    expect(screen.getByRole('textbox', { name: 'Goal' })).toBe(input)
    expect(input).toHaveValue('Translate documents keep editing')
    expect(input).toHaveFocus()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()

    act(() => {
      store.set(difyBuilderSessionViewAtom, (view) => ({ ...view!, reply_language: 'zh-Hans' }))
    })
    await waitFor(() => expect(mocks.loadResource).toHaveBeenCalledWith('zh-Hans', 'common'))
    expect(screen.getByRole('button', { name: frenchCommon['operation.close'] })).toBeVisible()
    expect(
      screen.getByRole('heading', { name: chineseBuilder['copy.labels.noRepairAvailable'] }),
    ).toBeVisible()

    await act(async () => resolveChineseCommon())

    expect(screen.getByRole('button', { name: chineseCommon['operation.close'] })).toBeVisible()
    expect(
      screen.getByRole('heading', { name: chineseBuilder['copy.labels.noRepairAvailable'] }),
    ).toBeVisible()
    expect(input).toHaveValue('Translate documents keep editing')
    expect(input).toHaveFocus()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('keeps the ready language and draft when a target dictionary fails to load', async () => {
    const user = userEvent.setup()
    let resolveTranslations!: () => void
    const pending = new Promise<void>((resolve) => {
      resolveTranslations = resolve
    })
    mocks.loadResource.mockImplementation(
      async (
        locale: keyof typeof translations,
        namespace: keyof (typeof translations)['en-US'],
      ) => {
        await pending
        if (namespace === 'difyBuilder') throw new Error('Translation chunk failed to load')
        return { default: translations[locale][namespace] }
      },
    )
    const store = await renderPanel('en-US', { preloadReplyLocale: false })
    await screen.findByRole('complementary', { name: englishBuilder.panelTitle })
    showRequirements(store)
    const input = screen.getByRole('textbox', { name: 'Goal' })
    await user.type(input, ' keep this draft')
    act(() => {
      store.set(difyBuilderSessionViewAtom, (view) => ({ ...view!, reply_language: 'zh-Hans' }))
    })
    await waitFor(() => expect(mocks.loadResource).toHaveBeenCalledWith('zh-Hans', 'difyBuilder'))

    await act(async () => resolveTranslations())

    expect(screen.getByRole('button', { name: englishCommon['operation.close'] })).toBeVisible()
    expect(
      screen.getByRole('button', { name: englishBuilder['copy.actions.submitRequirements'] }),
    ).toBeVisible()
    expect(screen.getByRole('textbox', { name: 'Goal' })).toBe(input)
    expect(input).toHaveValue('Translate documents keep this draft')
    expect(input).toHaveFocus()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(mocks.closePanel).not.toHaveBeenCalled()
  })
})
