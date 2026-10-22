import type { DifyBuilderActiveInteraction, DifyBuilderDecision, SessionView } from '../types'
import type { Locale } from '@/i18n/locale'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createStore, Provider } from 'jotai'
import { Suspense } from 'react'
import { getI18n, useTranslation } from 'react-i18next'
import { I18nClientProvider } from '@/app/components/provider/i18n'
import englishCommon from '@/i18n/locales/en-US/common.json'
import englishBuilder from '@/i18n/locales/en-US/dify-builder.json'
import englishWorkflow from '@/i18n/locales/en-US/workflow.json'
import frenchBuilder from '@/i18n/locales/fr-FR/dify-builder.json'
import chineseCommon from '@/i18n/locales/zh-Hans/common.json'
import chineseBuilder from '@/i18n/locales/zh-Hans/dify-builder.json'
import chineseAgent from '@/i18n/locales/zh-Hans/workflow-agent.json'
import chineseWorkflow from '@/i18n/locales/zh-Hans/workflow.json'
import { ConversationCard } from '../conversation/conversation-card'
import { DifyBuilderInteractionDock } from '../interactions/interaction-dock'
import { DifyBuilderLocaleProvider } from '../interactions/locale-provider'
import { createNativeReceipt, createSessionView } from '../session/__tests__/fixtures'
import { difyBuilderSessionViewAtom } from '../session/state'

vi.unmock('react-i18next')
vi.mock('@/app/components/workflow/store', () => ({
  useStore: <T,>(selector: (state: { fileUploadConfig?: undefined }) => T) =>
    selector({ fileUploadConfig: undefined }),
}))

const AccountCopy = () => {
  const { t } = useTranslation(['common'])
  return <button type="button">{t(($) => $['operation.cancel'], { ns: 'common' })}</button>
}

const testForm = {
  action_id: 'provide_testdata',
  card_seq: 0,
  valid_at_version: 1,
  card: {
    seq: 0,
    at_version: 1,
    kind: 'form',
    payload: {
      variant: 'testdata',
      fields: [
        { key: 'message', label: 'Goal', type: 'text', required: true },
        { key: 'enabled', label: 'Enabled', type: 'bool', default: true },
      ],
    },
  },
} satisfies DifyBuilderActiveInteraction

const renderInteraction = ({
  accountLocale = 'en-US',
  activeInteraction = null,
  decision = null,
  replyLanguage = 'zh-Hans',
}: {
  accountLocale?: Locale
  activeInteraction?: DifyBuilderActiveInteraction | null
  decision?: DifyBuilderDecision | null
  replyLanguage?: string
}) => {
  const store = createStore()
  const view: SessionView = createSessionView({ reply_language: replyLanguage })
  store.set(difyBuilderSessionViewAtom, view)
  const submitInteraction = vi.fn(async () => true)
  render(
    <I18nClientProvider locale={accountLocale} resource={{}}>
      <Provider store={store}>
        <Suspense fallback={<p>Loading translations</p>}>
          <DifyBuilderLocaleProvider>
            <AccountCopy />
            <ConversationCard
              invalidated={false}
              item={{
                kind: 'interaction_response',
                seq: 2,
                at_version: 1,
                payload: {
                  interaction_kind: 'form',
                  question: '历史服务端回执',
                  fields: [
                    { key: 'message', label: 'History', value: 'Goal', display_value: 'Goal' },
                  ],
                },
              }}
            />
            <DifyBuilderInteractionDock
              activeInteraction={activeInteraction}
              busy={false}
              decision={decision}
              interactionPending={false}
              recheckReady
              submitInteraction={submitInteraction}
            />
          </DifyBuilderLocaleProvider>
        </Suspense>
      </Provider>
    </I18nClientProvider>,
  )
  return { store, submitInteraction, view }
}

describe('Builder interaction language', () => {
  it.each([
    { replyLanguage: 'en', builder: englishBuilder },
    { replyLanguage: 'zh-Hans', builder: chineseBuilder },
  ])(
    'renders recovery reasons in the existing choice using $replyLanguage',
    async ({ replyLanguage, builder }) => {
      const user = userEvent.setup()
      const { submitInteraction } = renderInteraction({
        replyLanguage,
        decision: {
          title: { type: 'copy', id: 'decision.howShouldBuilderContinue' },
          description: {
            type: 'copy',
            id: 'replies.onlyNodeSettingsChangedSinceYouLeftContinueOrRestart',
          },
          default_option_id: 'recovery_continue',
          options: [
            { id: 'recovery_continue', label: { type: 'copy', id: 'actions.continue' } },
            { id: 'restart', label: { type: 'copy', id: 'actions.restartFromCurrentDraft' } },
          ],
          submit: { id: 'confirm', kind: 'primary', label: { type: 'copy', id: 'actions.submit' } },
        },
      })
      const reason = await screen.findByText(
        builder['copy.replies.onlyNodeSettingsChangedSinceYouLeftContinueOrRestart'],
      )
      expect(reason).toBeVisible()
      expect(screen.getAllByText(reason.textContent!)).toHaveLength(1)
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(screen.getByRole('radio', { name: builder['copy.actions.continue'] })).toBeChecked()
      await user.click(screen.getByRole('button', { name: builder['copy.actions.submit'] }))
      expect(submitInteraction).toHaveBeenCalledWith(
        'confirm',
        { option_id: 'recovery_continue' },
        expect.any(Object),
      )
    },
  )

  it.each([
    {
      accountLocale: 'en-US',
      replyLanguage: 'zh-Hans',
      workflow: chineseWorkflow,
      builder: chineseBuilder,
      account: englishCommon,
    },
    {
      accountLocale: 'zh-Hans',
      replyLanguage: 'en',
      workflow: englishWorkflow,
      builder: englishBuilder,
      account: chineseCommon,
    },
  ] as const)(
    'uses $replyLanguage for forms and validation without changing the $accountLocale account',
    async ({ accountLocale, replyLanguage, workflow, account, builder }) => {
      const user = userEvent.setup()
      const { submitInteraction } = renderInteraction({
        accountLocale,
        replyLanguage,
        activeInteraction: testForm,
      })
      const submit = await screen.findByRole('button', { name: builder.runTest })
      expect(screen.getByRole('button', { name: account['operation.cancel'] })).toBeVisible()
      await user.click(submit)
      expect(await screen.findByRole('alert')).toHaveTextContent(
        workflow['errorMsg.fieldRequired'].replace('{{field}}', 'Goal'),
      )
      expect(submitInteraction).not.toHaveBeenCalled()
      const input = screen.getByRole('textbox', { name: 'Goal' })
      expect(input).toHaveFocus()
      await user.type(input, 'Goal')
      await user.click(submit)
      expect(submitInteraction).toHaveBeenCalledWith(
        'provide_testdata',
        {
          mode: 'provide',
          inputs: { message: 'Goal', enabled: true },
        },
        expect.objectContaining({
          booleanTrue: replyLanguage === 'en' ? 'Yes' : '是',
          booleanFalse: replyLanguage === 'en' ? 'No' : '否',
        }),
      )
      expect(getI18n()?.language).toBe(accountLocale)
      expect(screen.getByRole('button', { name: account['operation.cancel'] })).toBeVisible()
    },
  )

  it('changes fixed copy with the session language while keeping drafts and persisted responses', async () => {
    const user = userEvent.setup()
    const { store, view } = renderInteraction({ activeInteraction: testForm })
    await screen.findByRole('button', { name: chineseBuilder.runTest })
    await user.type(screen.getByRole('textbox', { name: 'Goal' }), 'Yes')
    act(() => store.set(difyBuilderSessionViewAtom, { ...view, reply_language: 'fr' }))
    await screen.findByRole('button', { name: frenchBuilder.runTest })
    expect(screen.getByRole('textbox', { name: 'Goal' })).toHaveValue('Yes')
    expect(screen.getByRole('textbox', { name: 'History' })).toHaveValue('Goal')
    expect(screen.getByRole('heading', { name: '历史服务端回执' })).toBeVisible()
    expect(getI18n()?.language).toBe('en-US')
  })

  it('prefers the server submit label and keeps the no-repair interaction meaning', async () => {
    renderInteraction({
      decision: {
        title: { type: 'copy', id: 'labels.noRepairAvailable' },
        default_option_id: 'retry_repair',
        options: [
          { id: 'retry_repair', label: { type: 'copy', id: 'actions.tryAgain' } },
          { id: 'finish_repair', label: { type: 'copy', id: 'actions.finish' } },
        ],
        submit: { id: 'confirm', kind: 'primary', label: '服务端提交标签' },
      },
    })
    expect(await screen.findByRole('button', { name: '服务端提交标签' })).toBeEnabled()
    expect(
      await screen.findByRole('region', { name: chineseBuilder['copy.labels.noRepairAvailable'] }),
    ).toBeVisible()
    expect(
      screen.getByRole('radio', { name: chineseBuilder['copy.actions.tryAgain'] }),
    ).toBeChecked()
    expect(screen.getByRole('radio', { name: chineseBuilder['copy.actions.finish'] })).toBeVisible()
    expect(screen.queryByRole('textbox', { name: /reason/i })).not.toBeInTheDocument()
  })

  it('uses the interaction Submit fallback when the decision has no submit metadata', async () => {
    renderInteraction({
      decision: { title: '服务器决策', options: [{ id: 'approve_plan', label: '服务器选项' }] },
    })
    expect(
      await screen.findByRole('button', { name: chineseCommon['operation.submit'] }),
    ).toBeEnabled()
    expect(screen.getByRole('radio', { name: '服务器选项' })).toBeChecked()
  })

  it.each([
    { actionId: 'submit_requirements', variant: 'build_requirements' },
    { actionId: 'submit_edit_rules', variant: 'edit_rules' },
  ])(
    'localizes $actionId while preserving its default and edited values',
    async ({ actionId, variant }) => {
      const user = userEvent.setup()
      const { submitInteraction } = renderInteraction({
        activeInteraction: {
          ...testForm,
          action_id: actionId,
          card: {
            ...testForm.card,
            payload: {
              variant,
              fields: [{ key: 'message', label: 'Goal', type: 'text', default: 'Yes' }],
            },
          },
        },
      })
      const submit = await screen.findByRole('button', { name: chineseCommon['operation.submit'] })
      const input = screen.getByRole('textbox', { name: 'Goal' })
      expect(input).toHaveValue('Yes')
      await user.clear(input)
      await user.type(input, 'Goal')
      await user.click(submit)
      expect(submitInteraction).toHaveBeenCalledWith(
        actionId,
        { message: 'Goal' },
        expect.any(Object),
      )
    },
  )

  it('loads validation copy from the interaction language in the agent namespace', async () => {
    const user = userEvent.setup()
    const { submitInteraction } = renderInteraction({
      activeInteraction: {
        ...testForm,
        card: {
          ...testForm.card,
          payload: {
            variant: 'testdata',
            fields: [{ key: 'profile', label: 'Goal', type: 'json_object' }],
            values: { profile: '[]' },
          },
        },
      },
    })
    await user.click(await screen.findByRole('button', { name: chineseBuilder.runTest }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      `Goal: ${chineseAgent['nodes.agent.outputVars.defaultValueObjectInvalid']}`,
    )
    expect(screen.getByRole('textbox', { name: 'Goal' })).toHaveAccessibleDescription(
      `Goal: ${chineseAgent['nodes.agent.outputVars.defaultValueObjectInvalid']}`,
    )
    expect(submitInteraction).not.toHaveBeenCalled()
  })

  it('localizes resource status and submits an empty selection with local receipt copy', async () => {
    const user = userEvent.setup()
    const { submitInteraction } = renderInteraction({
      activeInteraction: {
        action_id: 'confirm_resources',
        card_seq: 0,
        valid_at_version: 1,
        card: {
          seq: 0,
          at_version: 1,
          kind: 'resource_select',
          payload: {
            recommended: [
              { id: 'resource-goal', kind: 'tool', label: 'Goal', meta: 'Yes', readiness: 'ready' },
              {
                id: 'resource-yes',
                kind: 'tool',
                label: 'Yes',
                meta: 'Goal',
                readiness: 'missing_config',
              },
            ],
          },
        },
      },
    })
    const submit = await screen.findByRole('button', { name: chineseCommon['operation.submit'] })
    const goal = screen.getByRole('checkbox', { name: 'Goal' })
    const yes = screen.getByRole('checkbox', { name: 'Yes' })
    expect(goal).toHaveAccessibleDescription(`Yes · ${chineseBuilder.resourceReady}`)
    expect(yes).toHaveAccessibleDescription(`Goal · ${chineseBuilder.resourceNeedsAuthorization}`)
    await user.click(goal)
    await user.click(yes)
    await user.click(submit)
    expect(submitInteraction).toHaveBeenCalledWith(
      'confirm_resources',
      { resource_ids: [] },
      {
        booleanFalse: '否',
        booleanTrue: '是',
        noResourcesSelected: '未选择资源',
        renderText: expect.any(Function),
        replyLanguage: 'zh-Hans',
      },
    )
  })
})

describe('native risk choice consent', () => {
  it('requires explicit selection instead of preselecting approval', async () => {
    const user = userEvent.setup()
    renderInteraction({
      replyLanguage: 'en-US',
      decision: {
        title: 'Approve this call?',
        description: 'Reads one synthetic message',
        options: [
          { id: 'confirm_test_operation', label: 'Approve', tone: 'primary' },
          { id: 'deny_test_operation', label: 'Reject', tone: 'danger' },
        ],
        default_option_id: '',
      },
    })
    const submit = await screen.findByRole('button', { name: englishCommon['operation.submit'] })
    expect(submit).toBeDisabled()
    await user.click(screen.getByRole('radio', { name: 'Approve' }))
    expect(submit).toBeEnabled()
  })
})

describe('replacement native disclosure', () => {
  it('clears an approval selection when the pending scope changes at the same Builder version', async () => {
    const user = userEvent.setup()
    const { store, view, submitInteraction } = renderInteraction({
      replyLanguage: 'en-US',
      decision: {
        title: 'Approve call',
        options: [
          { id: 'confirm_test_operation', label: 'Approve' },
          { id: 'deny_test_operation', label: 'Reject' },
        ],
        default_option_id: '',
      },
    })
    const payload = {
      request_id: 'request-1',
      pending_operation_id: 'pending-A',
      pending_version: 1,
      scope_digest: 'a'.repeat(64),
    }
    act(() =>
      store.set(difyBuilderSessionViewAtom, {
        ...view,
        test_execution: createNativeReceipt({ status: 'waiting' }),
        actions: [{ id: 'confirm_test_operation', label: 'Approve', kind: 'primary', payload }],
      }),
    )
    const submit = await screen.findByRole('button', { name: englishCommon['operation.submit'] })
    await user.click(screen.getByRole('radio', { name: 'Approve' }))
    expect(submit).toBeEnabled()
    const replacement = {
      ...payload,
      pending_operation_id: 'pending-B',
      scope_digest: 'b'.repeat(64),
    }
    act(() =>
      store.set(difyBuilderSessionViewAtom, {
        ...view,
        test_execution: createNativeReceipt({ status: 'waiting' }),
        actions: [
          { id: 'confirm_test_operation', label: 'Approve', kind: 'primary', payload: replacement },
        ],
      }),
    )
    expect(screen.getByRole('button', { name: englishCommon['operation.submit'] })).toBeDisabled()
    await user.click(screen.getByRole('radio', { name: 'Approve' }))
    await user.click(screen.getByRole('button', { name: englishCommon['operation.submit'] }))
    expect(submitInteraction).toHaveBeenCalledWith(
      'confirm',
      { option_id: 'confirm_test_operation', ...replacement },
      expect.any(Object),
    )
  })
})
