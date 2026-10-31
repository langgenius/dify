import type {
  MessageTemplateTestResponse,
  PostAppsByAppIdAdvancedChatWorkflowsDraftHumanInputNodesByNodeIdMessageTemplateTestData,
  PostAppsByAppIdWorkflowsDraftHumanInputNodesByNodeIdMessageTemplateTestData,
} from '@dify/contracts/api/console/apps/types.gen'
import type {
  ChannelSummary,
  ListChannelsResponse,
} from '@dify/contracts/api/console/workspaces/types.gen'
import type { ComponentProps } from 'react'
import type { EditorResource } from '@/app/components/workflow/editor-resource/resource'
import type { Shape } from '@/app/components/workflow/hooks-store/store'
import { ORPCError } from '@orpc/client'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { ReactFlowProvider } from 'reactflow'
import { replacePromptEditorText } from '@/app/components/base/prompt-editor/plugins/__tests__/test-helpers'
import { renderWorkflowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { EditorResourceScope } from '@/app/components/workflow/editor-resource/provider'
import { HooksStoreContextProvider } from '@/app/components/workflow/hooks-store/provider'
import { VarType } from '@/app/components/workflow/types'
import { consoleQuery } from '@/service/console'
import { seedModelProviderQueries } from '@/test/console/model-provider'
import { createDeferred } from '@/test/deferred'
import MessageTemplate from '../components/message-template'
import { createChannelsQueryClient } from './channel-fixtures'

const mocks = vi.hoisted(() => ({
  syncDraft: vi.fn<Shape['doSyncWorkflowDraft']>(),
  workflowTest:
    vi.fn<
      (
        input: PostAppsByAppIdWorkflowsDraftHumanInputNodesByNodeIdMessageTemplateTestData,
      ) => Promise<MessageTemplateTestResponse>
    >(),
  chatflowTest:
    vi.fn<
      (
        input: PostAppsByAppIdAdvancedChatWorkflowsDraftHumanInputNodesByNodeIdMessageTemplateTestData,
      ) => Promise<MessageTemplateTestResponse>
    >(),
}))

const originalBody = 'Original body {{#url#}}'

vi.mock('@/service/console', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/service/console')>()
  const { withConsoleResponses } = await import('@/test/console/service-responses')
  return {
    ...actual,
    consoleQuery: withConsoleResponses(actual.consoleQuery, {
      'apps.byAppId.workflows.draft.humanInput.nodes.byNodeId.messageTemplate.test.post':
        mocks.workflowTest,
      'apps.byAppId.advancedChat.workflows.draft.humanInput.nodes.byNodeId.messageTemplate.test.post':
        mocks.chatflowTest,
    }),
  }
})

type TemplateProps = ComponentProps<typeof MessageTemplate>

const TemplateCaller = ({ value: initialValue, onChange, ...props }: TemplateProps) => {
  const [value, setValue] = useState(initialValue)
  return (
    <>
      <MessageTemplate
        {...props}
        value={value}
        onChange={(nextValue) => {
          setValue(nextValue)
          onChange(nextValue)
        }}
      />
      <output aria-label="Committed subject">{value.subject}</output>
      <output aria-label="Committed body">{value.body}</output>
    </>
  )
}

type TemplateEnvironmentProps = {
  props: TemplateProps
  hooksStoreProps: Partial<Shape>
  resource: EditorResource
}

const TemplateEnvironment = ({ props, hooksStoreProps, resource }: TemplateEnvironmentProps) => (
  <ReactFlowProvider>
    <HooksStoreContextProvider {...hooksStoreProps}>
      <EditorResourceScope resource={resource}>
        <TemplateCaller {...props} />
      </EditorResourceScope>
    </HooksStoreContextProvider>
  </ReactFlowProvider>
)

const renderTemplate = (
  overrides: Partial<ComponentProps<typeof MessageTemplate>> = {},
  storeOverrides: Partial<Shape> = {},
  configuredProviders?: ChannelSummary['provider'][],
  resource: EditorResource = {
    kind: 'app',
    appId: 'app-template-test',
    mode: 'workflow',
  },
) => {
  const props: TemplateProps = {
    nodeId: 'human-input-v2',
    value: { subject: 'Original subject', body: originalBody },
    onChange: vi.fn(),
    readonly: false,
    availableVars: [],
    availableNodes: [],
    ...overrides,
  }
  const queryClient = createChannelsQueryClient(configuredProviders)
  seedModelProviderQueries(queryClient)
  const hooksStoreProps = {
    doSyncWorkflowDraft: mocks.syncDraft,
    ...storeOverrides,
  }
  let environmentProps: TemplateEnvironmentProps = { props, hooksStoreProps, resource }
  const view = renderWorkflowComponent(<TemplateEnvironment {...environmentProps} />, {
    queryClient,
  })
  return {
    ...view,
    props,
    queryClient,
    rerenderEnvironment: (overrides: Partial<TemplateEnvironmentProps>) => {
      environmentProps = { ...environmentProps, ...overrides }
      view.rerender(<TemplateEnvironment {...environmentProps} />)
    },
  }
}

const openTemplate = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole('button', { name: 'workflow.common.configure' }))
}

const openTest = async (user: ReturnType<typeof userEvent.setup>) => {
  await openTemplate(user)
  await user.click(
    screen.getByRole('button', { name: 'workflow.nodes.humanInputV2.template.test' }),
  )
}

const sendTest = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(
    screen.getByRole('button', { name: 'workflow.nodes.humanInputV2.template.saveAndTest' }),
  )
}

const getBodyEditor = () =>
  screen.getByRole('textbox', { name: 'workflow.nodes.humanInputV2.template.body' })

const setBody = async (value: string) => replacePromptEditorText(getBodyEditor(), value)

const expectNoTemplateTest = () => {
  expect(mocks.workflowTest).not.toHaveBeenCalled()
  expect(mocks.chatflowTest).not.toHaveBeenCalled()
}

describe('Human Input v2 Message Template', () => {
  beforeEach(() => {
    mocks.workflowTest.mockResolvedValue({})
    mocks.chatflowTest.mockResolvedValue({})
    mocks.syncDraft.mockImplementation(async (_notRefresh, callbacks) => {
      callbacks?.onSuccess?.()
      return { hash: 'saved-draft', updatedAt: 1 }
    })
  })

  it('preserves existing subject variables while committing subject and body edits together', async () => {
    const user = userEvent.setup()
    const { props } = renderTemplate({
      value: { subject: 'Original subject{{#start.email#}}', body: originalBody },
    })
    await openTemplate(user)

    const subject = screen.getByLabelText('workflow.nodes.humanInputV2.template.subject')
    expect(subject).toHaveValue('Original subject{{#start.email#}}')
    expect(screen.getByLabelText('Committed body')).toHaveTextContent(originalBody)

    await user.type(subject, ' updated')
    await setBody('Updated body {{#url#}}')
    await user.click(screen.getByRole('button', { name: 'common.operation.save' }))

    expect(props.onChange).toHaveBeenCalledWith({
      subject: 'Original subject{{#start.email#}} updated',
      body: 'Updated body {{#url#}}',
    })
    expect(screen.getByLabelText('Committed subject')).toHaveTextContent(
      'Original subject{{#start.email#}} updated',
    )
    expect(screen.getByLabelText('Committed body')).toHaveTextContent('Updated body {{#url#}}')
    await openTemplate(user)
    expect(screen.getByLabelText('workflow.nodes.humanInputV2.template.subject')).toHaveValue(
      'Original subject{{#start.email#}} updated',
    )
  })

  it('discards local drafts on Cancel and Escape and restores trigger focus', async () => {
    const user = userEvent.setup()
    renderTemplate()
    await openTemplate(user)
    const subject = screen.getByLabelText('workflow.nodes.humanInputV2.template.subject')
    await user.clear(subject)
    await user.type(subject, 'Unsaved')
    await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'workflow.common.configure' })).toHaveFocus(),
    )
    await openTemplate(user)
    expect(screen.getByLabelText('workflow.nodes.humanInputV2.template.subject')).toHaveValue(
      'Original subject',
    )

    await user.clear(screen.getByLabelText('workflow.nodes.humanInputV2.template.subject'))
    await user.type(
      screen.getByLabelText('workflow.nodes.humanInputV2.template.subject'),
      'Discard with Escape',
    )
    await user.keyboard('{Escape}')
    await openTemplate(user)
    expect(screen.getByLabelText('workflow.nodes.humanInputV2.template.subject')).toHaveValue(
      'Original subject',
    )
  })

  it('validates both local fields and does not submit twice', async () => {
    const user = userEvent.setup()
    const { props } = renderTemplate()
    await openTemplate(user)
    await user.clear(screen.getByLabelText('workflow.nodes.humanInputV2.template.subject'))
    await setBody('')
    await user.click(screen.getByRole('button', { name: 'common.operation.save' }))

    expect(screen.getAllByRole('alert')).toHaveLength(2)
    expect(screen.getByText('workflow.nodes.humanInputV2.error.bodyRequired')).toBeInTheDocument()
    expect(props.onChange).not.toHaveBeenCalled()

    await user.type(
      screen.getByLabelText('workflow.nodes.humanInputV2.template.subject'),
      'Subject',
    )
    await setBody('Body {{#url#}}')
    const save = screen.getByRole('button', { name: 'common.operation.save' })
    await user.dblClick(save)
    expect(props.onChange).toHaveBeenCalledTimes(1)
  })

  it('opens a non-mutating read-only view', async () => {
    const user = userEvent.setup()
    const { props } = renderTemplate({
      readonly: true,
      value: { subject: 'Readonly subject', body: 'Legacy body without a Request URL' },
    })
    await openTemplate(user)

    expect(screen.getByLabelText('workflow.nodes.humanInputV2.template.subject')).toBeDisabled()
    expect(getBodyEditor()).toHaveAttribute('contenteditable', 'false')
    expect(screen.queryByRole('button', { name: 'common.operation.save' })).not.toBeInTheDocument()
    expect(props.onChange).not.toHaveBeenCalled()
  })

  it.each([
    { body: 'Review this request', error: 'requestURLRequired' },
    { body: 'Review {{#url#}} or {{#url#}}', error: 'requestURLDuplicate' },
  ])(
    'blocks saving an existing template with $error and focuses the body',
    async ({ body, error }) => {
      const user = userEvent.setup()
      const { props } = renderTemplate({ value: { subject: 'Subject', body } })
      await openTemplate(user)
      await user.click(screen.getByRole('button', { name: 'common.operation.save' }))

      expect(screen.getByRole('alert')).toHaveTextContent(
        `workflow.nodes.humanInputV2.error.${error}`,
      )
      await waitFor(() => expect(getBodyEditor()).toHaveFocus())
      expect(props.onChange).not.toHaveBeenCalled()
    },
  )

  it.each([
    { action: 'save', body: 'Review this request', error: 'requestURLRequired' },
    { action: 'save', body: 'Review {{#url#}} or {{#url#}}', error: 'requestURLDuplicate' },
    { action: 'test', body: 'Review this request', error: 'requestURLRequired' },
    { action: 'test', body: 'Review {{#url#}} or {{#url#}}', error: 'requestURLDuplicate' },
  ])(
    'validates $error while editing before $action and clears it when corrected',
    async ({ action, body, error }) => {
      const user = userEvent.setup()
      const { props } = renderTemplate()
      if (action === 'test') await openTest(user)
      else await openTemplate(user)
      await setBody(body)

      expect(screen.getByRole('alert')).toHaveTextContent(
        `workflow.nodes.humanInputV2.error.${error}`,
      )
      if (action === 'test') await sendTest(user)
      else await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
      await waitFor(() => expect(getBodyEditor()).toHaveFocus())
      expect(props.onChange).not.toHaveBeenCalled()
      expect(mocks.syncDraft).not.toHaveBeenCalled()
      expectNoTemplateTest()

      await setBody('Review {{#url#}}')
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      if (action === 'test') {
        await sendTest(user)
        expect(
          await screen.findByText('workflow.nodes.humanInputV2.template.testCompleted'),
        ).toBeInTheDocument()
        expect(mocks.workflowTest).toHaveBeenCalledOnce()
      } else {
        await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
      }
      expect(props.onChange).toHaveBeenCalledOnce()
      expect(props.onChange).toHaveBeenCalledWith({
        subject: 'Original subject',
        body: 'Review {{#url#}}',
      })
    },
  )

  it('opens test settings from the card without sending and discards changes with Close', async () => {
    const user = userEvent.setup()
    const { props } = renderTemplate()
    const testTrigger = screen.getByRole('button', {
      name: 'workflow.nodes.humanInputV2.template.test',
    })
    await user.click(testTrigger)

    expect(
      screen.getByRole('combobox', { name: 'workflow.nodes.humanInputV2.template.testChannel' }),
    ).toBeInTheDocument()
    expectNoTemplateTest()
    expect(mocks.syncDraft).not.toHaveBeenCalled()
    await user.clear(screen.getByLabelText('workflow.nodes.humanInputV2.template.subject'))
    await user.type(
      screen.getByLabelText('workflow.nodes.humanInputV2.template.subject'),
      'Unsaved test subject',
    )
    await user.click(screen.getByRole('button', { name: 'common.operation.close' }))
    expect(props.onChange).not.toHaveBeenCalled()
    await waitFor(() => expect(testTrigger).toHaveFocus())
    await openTemplate(user)
    expect(screen.getByLabelText('workflow.nodes.humanInputV2.template.subject')).toHaveValue(
      'Original subject',
    )
  })

  it('offers only the workspace configured Email and Slack channels for template tests', async () => {
    const user = userEvent.setup()
    renderTemplate()
    await openTest(user)
    await user.click(
      screen.getByRole('combobox', { name: 'workflow.nodes.humanInputV2.template.testChannel' }),
    )

    expect(
      screen.getByRole('option', { name: 'workflow.nodes.humanInputV2.debug.channel.email' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('option', { name: 'workflow.nodes.humanInputV2.debug.channel.slack' }),
    ).toBeInTheDocument()
    expect(screen.getAllByRole('option')).toHaveLength(2)
    expect(
      screen.queryByRole('option', { name: 'workflow.nodes.humanInputV2.debug.channel.feishu' }),
    ).not.toBeInTheDocument()
  })

  it('defaults to the configured IM channel when Email is not configured', async () => {
    const user = userEvent.setup()
    renderTemplate({}, {}, ['slack'])
    await openTest(user)

    expect(
      screen.getByRole('combobox', { name: 'workflow.nodes.humanInputV2.template.testChannel' }),
    ).toHaveTextContent('workflow.nodes.humanInputV2.debug.channel.slack')
    await sendTest(user)

    expect(
      await screen.findByText('workflow.nodes.humanInputV2.template.testCompleted'),
    ).toBeInTheDocument()
    expect(mocks.workflowTest).toHaveBeenCalledWith({
      params: { app_id: 'app-template-test', node_id: 'human-input-v2' },
      body: { channel: 'slack', inputs: {} },
    })
  })

  it('does not save or send a test when the workspace has no configured channels', async () => {
    const user = userEvent.setup()
    const { props } = renderTemplate({}, {}, [])
    await openTest(user)

    expect(
      screen.getByRole('button', { name: 'workflow.nodes.humanInputV2.template.saveAndTest' }),
    ).toBeDisabled()
    await sendTest(user)

    expect(mocks.syncDraft).not.toHaveBeenCalled()
    expect(props.onChange).not.toHaveBeenCalled()
    expectNoTemplateTest()
  })

  it('uses the remaining configured channel when the selected channel is removed while open', async () => {
    const user = userEvent.setup()
    const { queryClient } = renderTemplate()
    await openTest(user)
    const channelQueryKey =
      consoleQuery.workspaces.current.humanInput.v2.channels.get.queryOptions().queryKey
    const configured = queryClient.getQueryData<ListChannelsResponse>(channelQueryKey)

    await act(async () => {
      queryClient.setQueryData(channelQueryKey, {
        channels: configured?.channels.filter((channel) => channel.kind === 'im') ?? [],
      } satisfies ListChannelsResponse)
    })

    await waitFor(() =>
      expect(
        screen.getByRole('combobox', { name: 'workflow.nodes.humanInputV2.template.testChannel' }),
      ).toHaveTextContent('workflow.nodes.humanInputV2.debug.channel.slack'),
    )
    await sendTest(user)
    expect(
      await screen.findByText('workflow.nodes.humanInputV2.template.testCompleted'),
    ).toBeInTheDocument()
    expect(mocks.workflowTest).toHaveBeenCalledWith({
      params: { app_id: 'app-template-test', node_id: 'human-input-v2' },
      body: { channel: 'slack', inputs: {} },
    })
  })

  it('does not send to a channel removed while the template is being saved', async () => {
    const user = userEvent.setup()
    let finishSave = () => {}
    mocks.syncDraft.mockImplementationOnce(
      (_notRefresh, callbacks) =>
        new Promise((resolve) => {
          finishSave = () => {
            callbacks?.onSuccess?.()
            resolve({ hash: 'saved-draft', updatedAt: 1 })
          }
        }),
    )
    const { queryClient } = renderTemplate()
    await openTest(user)
    await sendTest(user)
    expect(mocks.syncDraft).toHaveBeenCalledTimes(1)

    const queryKey =
      consoleQuery.workspaces.current.humanInput.v2.channels.get.queryOptions().queryKey
    const configured = queryClient.getQueryData<ListChannelsResponse>(queryKey)
    await act(async () => {
      queryClient.setQueryData(queryKey, {
        channels: configured?.channels.filter((channel) => channel.kind === 'im') ?? [],
      } satisfies ListChannelsResponse)
    })
    await waitFor(() =>
      expect(screen.getByRole('combobox')).toHaveTextContent(
        'workflow.nodes.humanInputV2.debug.channel.slack',
      ),
    )
    await act(async () => finishSave())
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'workflow.nodes.humanInputV2.template.saveAndTest' }),
      ).toBeEnabled(),
    )
    expectNoTemplateTest()

    await sendTest(user)
    expect(
      await screen.findByText('workflow.nodes.humanInputV2.template.testCompleted'),
    ).toBeInTheDocument()
    expect(mocks.workflowTest).toHaveBeenCalledWith({
      params: { app_id: 'app-template-test', node_id: 'human-input-v2' },
      body: { channel: 'slack', inputs: {} },
    })
  })

  it.each([
    { mode: 'workflow', chat: false },
    { mode: 'chatflow', chat: true },
  ])('sends a $mode template test through its generated route after saving', async ({ chat }) => {
    const user = userEvent.setup()
    let completeSave = () => {}
    mocks.syncDraft.mockImplementationOnce(
      (_notRefresh, callbacks) =>
        new Promise((resolve) => {
          completeSave = () => {
            callbacks?.onSuccess?.()
            resolve({ hash: 'saved-new-template', updatedAt: 2 })
          }
        }),
    )
    const { props } = renderTemplate({}, {}, ['resend', 'lark'], {
      kind: 'app',
      appId: 'app-template-test',
      mode: chat ? 'advanced-chat' : 'workflow',
    })
    await openTest(user)
    await user.clear(screen.getByLabelText('workflow.nodes.humanInputV2.template.subject'))
    await user.type(
      screen.getByLabelText('workflow.nodes.humanInputV2.template.subject'),
      'Updated test subject',
    )
    await user.click(
      screen.getByRole('combobox', { name: 'workflow.nodes.humanInputV2.template.testChannel' }),
    )
    await user.click(
      await screen.findByRole('option', {
        name: 'workflow.nodes.humanInputV2.debug.channel.lark',
      }),
    )
    await sendTest(user)

    expect(props.onChange).toHaveBeenCalledWith({
      subject: 'Updated test subject',
      body: originalBody,
    })
    expect(mocks.syncDraft).toHaveBeenCalledTimes(1)
    expectNoTemplateTest()

    await act(async () => completeSave())
    expect(
      await screen.findByText('workflow.nodes.humanInputV2.template.testCompleted'),
    ).toBeInTheDocument()
    const selectedService = chat ? mocks.chatflowTest : mocks.workflowTest
    const otherService = chat ? mocks.workflowTest : mocks.chatflowTest
    expect(selectedService).toHaveBeenCalledWith({
      params: { app_id: 'app-template-test', node_id: 'human-input-v2' },
      body: { channel: 'lark', inputs: {} },
    })
    expect(otherService).not.toHaveBeenCalled()
  })

  it.each(['app changes', 'run permission is revoked'] as const)(
    'does not send a stale test when %s while the draft save is pending',
    async (change) => {
      const user = userEvent.setup()
      let completeSave = () => {}
      mocks.syncDraft.mockImplementationOnce(
        (_notRefresh, callbacks) =>
          new Promise((resolve) => {
            completeSave = () => {
              callbacks?.onSuccess?.()
              resolve({ hash: 'saved-before-context-change', updatedAt: 3 })
            }
          }),
      )
      const { rerenderEnvironment } = renderTemplate()
      await openTest(user)
      await sendTest(user)
      expect(mocks.syncDraft).toHaveBeenCalledTimes(1)
      expect(screen.getByLabelText('workflow.nodes.humanInputV2.template.subject')).toBeDisabled()

      if (change === 'app changes') {
        rerenderEnvironment({
          resource: {
            kind: 'app',
            appId: 'another-app',
            mode: 'workflow',
          },
        })
      } else {
        rerenderEnvironment({
          hooksStoreProps: {
            doSyncWorkflowDraft: mocks.syncDraft,
            accessControl: {
              canEdit: true,
              canRun: false,
              canImportExportDSL: true,
              canReleaseAndVersion: true,
            },
          },
        })
      }
      await act(async () => completeSave())

      expectNoTemplateTest()
      expect(
        screen.queryByText('workflow.nodes.humanInputV2.template.testCompleted'),
      ).not.toBeInTheDocument()
      if (change === 'run permission is revoked') {
        expect(
          screen.queryByRole('button', { name: 'workflow.nodes.humanInputV2.template.test' }),
        ).not.toBeInTheDocument()
      }
    },
  )

  it.each(['failed', 'skipped'] as const)(
    'does not send against a %s draft save',
    async (outcome) => {
      const user = userEvent.setup()
      mocks.syncDraft.mockImplementationOnce(async (_notRefresh, callbacks) => {
        if (outcome === 'failed') callbacks?.onError?.()
        return null
      })
      renderTemplate()
      await openTest(user)
      await sendTest(user)

      expect(
        await screen.findByText('workflow.nodes.humanInputV2.template.testSaveFailed'),
      ).toBeInTheDocument()
      expectNoTemplateTest()
      expect(
        screen.queryByText('workflow.nodes.humanInputV2.template.testCompleted'),
      ).not.toBeInTheDocument()
      expect(screen.getByLabelText('workflow.nodes.humanInputV2.template.subject')).toHaveValue(
        'Original subject',
      )
    },
  )

  it('reports an unavailable backend without claiming the test was sent', async () => {
    const user = userEvent.setup()
    mocks.workflowTest.mockRejectedValueOnce(
      new ORPCError('not_implemented', {
        status: 501,
        message: 'Human Input v2 draft stub endpoint is not implemented yet.',
      }),
    )
    renderTemplate()
    await openTest(user)
    await sendTest(user)

    expect(
      await screen.findByText('workflow.nodes.humanInputV2.template.testUnavailable'),
    ).toBeInTheDocument()
    expect(mocks.workflowTest).toHaveBeenCalledOnce()
    expect(
      screen.queryByText('workflow.nodes.humanInputV2.template.testCompleted'),
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'workflow.nodes.humanInputV2.template.saveAndTest' }),
    ).toBeEnabled()
  })

  it('deduplicates subject and body variables, preserving zero and string-array input types', async () => {
    const user = userEvent.setup()
    renderTemplate({
      value: {
        subject: 'Review {{#start.score#}} and {{#start.owner#}}',
        body: '{{#start.score#}} {{#start.tags#}} {{#url#}} {{#env.secret#}}',
      },
      availableVars: [
        {
          nodeId: 'start',
          title: 'Start',
          vars: [
            { variable: 'score', type: VarType.number },
            { variable: 'owner', type: VarType.string },
            { variable: 'tags', type: VarType.arrayString },
          ],
        },
      ],
    })
    await openTest(user)
    expect(screen.getAllByLabelText('start.score')).toHaveLength(1)
    expect(screen.queryByLabelText('url')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('env.secret')).not.toBeInTheDocument()
    await sendTest(user)
    expect(
      await screen.findByText('workflow.nodes.humanInputV2.template.testInputsRequired'),
    ).toBeInTheDocument()
    expect(mocks.syncDraft).not.toHaveBeenCalled()
    expectNoTemplateTest()

    await user.type(screen.getByLabelText('start.score'), '0')
    await user.type(screen.getByLabelText('start.owner'), 'Reviewer')
    await user.click(screen.getByLabelText('start.tags'))
    await user.paste('["urgent", "legal"]')
    await sendTest(user)
    expect(
      await screen.findByText('workflow.nodes.humanInputV2.template.testCompleted'),
    ).toBeInTheDocument()
    expect(mocks.workflowTest).toHaveBeenCalledWith({
      params: { app_id: 'app-template-test', node_id: 'human-input-v2' },
      body: {
        channel: 'email',
        inputs: {
          '#start.score#': 0,
          '#start.owner#': 'Reviewer',
          '#start.tags#': ['urgent', 'legal'],
        },
      },
    })
  })

  it.each(['["valid", 1]', 'not JSON'])(
    'rejects invalid string-array test input %s before saving',
    async (input) => {
      const user = userEvent.setup()
      renderTemplate({
        value: { subject: 'Subject', body: '{{#start.tags#}} {{#url#}}' },
        availableVars: [
          {
            nodeId: 'start',
            title: 'Start',
            vars: [{ variable: 'tags', type: VarType.arrayString }],
          },
        ],
      })
      await openTest(user)
      await user.click(screen.getByLabelText('start.tags'))
      await user.paste(input)
      await sendTest(user)
      expect(
        await screen.findByText('workflow.errorMsg.invalidJson:{"field":"start.tags"}'),
      ).toBeInTheDocument()
      expect(mocks.syncDraft).not.toHaveBeenCalled()
      expectNoTemplateTest()
    },
  )

  it('keeps one request in flight when the send button is double-clicked', async () => {
    const user = userEvent.setup()
    const request = createDeferred<MessageTemplateTestResponse>()
    mocks.workflowTest.mockImplementationOnce(() => request.promise)
    const { props } = renderTemplate()
    await openTest(user)
    const send = screen.getByRole('button', {
      name: 'workflow.nodes.humanInputV2.template.saveAndTest',
    })
    await user.dblClick(send)
    await waitFor(() => expect(mocks.workflowTest).toHaveBeenCalledOnce())
    expect(mocks.syncDraft).toHaveBeenCalledTimes(1)
    expect(props.onChange).toHaveBeenCalledTimes(1)
    expect(screen.getByLabelText('workflow.nodes.humanInputV2.template.subject')).toBeDisabled()

    await act(async () => request.resolve({}))
    expect(
      await screen.findByText('workflow.nodes.humanInputV2.template.testCompleted'),
    ).toBeInTheDocument()
    expect(mocks.workflowTest).toHaveBeenCalledOnce()
  })

  it.each([
    {
      reason: 'read-only',
      readonly: true,
      canRun: true,
      resource: { kind: 'app', appId: 'app-template-test', mode: 'workflow' } as const,
    },
    {
      reason: 'no run permission',
      readonly: false,
      canRun: false,
      resource: { kind: 'app', appId: 'app-template-test', mode: 'workflow' } as const,
    },
    {
      reason: 'snippet',
      readonly: false,
      canRun: true,
      resource: { kind: 'snippet', snippetId: 'snippet-1' } as const,
    },
    {
      reason: 'missing app ID',
      readonly: false,
      canRun: true,
      resource: { kind: 'app', appId: '', mode: 'workflow' } as const,
    },
  ])('does not offer test sending for $reason', async ({ readonly, canRun, resource }) => {
    const user = userEvent.setup()
    renderTemplate(
      { readonly },
      {
        accessControl: {
          canEdit: true,
          canRun,
          canImportExportDSL: true,
          canReleaseAndVersion: true,
        },
      },
      undefined,
      resource,
    )
    await openTemplate(user)
    expect(
      screen.queryByRole('button', { name: 'workflow.nodes.humanInputV2.template.test' }),
    ).not.toBeInTheDocument()
    expect(mocks.syncDraft).not.toHaveBeenCalled()
    expectNoTemplateTest()
  })
})
