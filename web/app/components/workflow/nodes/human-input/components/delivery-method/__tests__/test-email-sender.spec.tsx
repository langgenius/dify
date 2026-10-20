import type { ReactNode } from 'react'
import type {
  EmailConfig,
  FormInputItem,
  ParagraphFormInput,
  SelectFormInput,
} from '../../../types'
import type { CodeNodeType } from '@/app/components/workflow/nodes/code/types'
import { QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { EditorResourceScope } from '@/app/components/workflow/editor-resource/provider'
import { HooksStoreContext } from '@/app/components/workflow/hooks-store/provider'
import { createHooksStore } from '@/app/components/workflow/hooks-store/store'
import { CodeLanguage } from '@/app/components/workflow/nodes/code/types'
import { BlockEnum, InputVarType, VarType } from '@/app/components/workflow/types'
import { toast } from '@/app/notifications'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { render } from '@/test/console/render'
import { createDeferred } from '@/test/deferred'
import EmailSenderModal from '../test-email-sender'

vi.mock('@/app/notifications', async (importOriginal) => ({
  ...(await importOriginal()),
  toast: {
    error: vi.fn(),
  },
}))

const mockConsoleState = vi.hoisted(() => ({
  userProfile: {
    id: 'user-1',
    email: 'owner@example.com',
    name: 'Owner',
  },
  currentWorkspace: {
    id: 'workspace-1',
    name: 'Product Team',
  },
}))

type RecordedRequest = {
  url: string
  method: string
  body?: unknown
}

const renderWithProviders = (ui: ReactNode) => {
  const { queryClient } = createConsoleQueryWrapper({
    accountProfile: mockConsoleState.userProfile,
    currentWorkspace: mockConsoleState.currentWorkspace,
  })
  const hooksStore = createHooksStore({})

  return render(
    <QueryClientProvider client={queryClient}>
      <EditorResourceScope resource={{ kind: 'app', appId: 'app-1', mode: 'workflow' }}>
        <HooksStoreContext.Provider value={hooksStore}>{ui}</HooksStoreContext.Provider>
      </EditorResourceScope>
    </QueryClientProvider>,
  )
}

const setupFetch = (deliveryResponse?: () => Promise<Response>) => {
  const requests: RecordedRequest[] = []
  const fetchSpy = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async (resource: RequestInfo | URL, options?: RequestInit) => {
      const request = resource instanceof Request ? resource : new Request(resource, options)
      const body = request.method === 'GET' ? undefined : await request.clone().json()
      requests.push({
        url: request.url,
        method: request.method,
        body,
      })

      if (request.url.includes('/workspaces/current/members')) {
        return new Response(
          JSON.stringify({
            accounts: [
              {
                id: 'member-1',
                email: 'member@example.com',
                name: 'Member One',
                avatar: '',
                avatar_url: '',
                status: 'active',
                role: 'normal',
                created_at: '',
                last_active_at: '',
                last_login_at: '',
              },
            ],
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        )
      }

      if (!request.url.endsWith('/delivery-test') || request.method !== 'POST')
        throw new Error(`Unexpected request: ${request.method} ${request.url}`)
      if (deliveryResponse) return deliveryResponse()

      return new Response(JSON.stringify({ result: 'success' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })

  return {
    fetchSpy,
    requests,
  }
}

const createConfig = (overrides: Partial<EmailConfig> = {}): EmailConfig => ({
  recipients: {
    whole_workspace: true,
    items: [],
  },
  subject: 'Review request',
  body: 'Please review {{#start.score#}}',
  debug_mode: false,
  ...overrides,
})

const TestEmailSenderHarness = () => {
  const [open, setOpen] = useState(true)

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open test email sender
      </button>
      <EmailSenderModal
        nodeId="human-node"
        deliveryId="delivery-1"
        open={open}
        onOpenChange={setOpen}
        jumpToEmailConfigModal={vi.fn()}
        config={createConfig({ body: '' })}
      />
    </>
  )
}

const createFormInput = (overrides: Partial<ParagraphFormInput> = {}): FormInputItem => ({
  type: InputVarType.paragraph,
  output_variable_name: 'user_name',
  default: {
    type: 'variable',
    selector: ['start', 'user_name'],
    value: '',
  },
  ...overrides,
})

const createDynamicSelectInput = (): SelectFormInput => ({
  type: InputVarType.select,
  output_variable_name: 'decision',
  option_source: {
    type: 'variable',
    selector: ['code', 'result'],
    value: [],
  },
})

describe('human-input/delivery-method/test-email-sender', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should submit generated variable inputs and show the success state', async () => {
    const user = userEvent.setup()
    const { requests } = setupFetch()
    const handleOpenChange = vi.fn()

    renderWithProviders(
      <EmailSenderModal
        nodeId="human-node"
        deliveryId="delivery-1"
        open
        onOpenChange={handleOpenChange}
        jumpToEmailConfigModal={vi.fn()}
        config={createConfig()}
        formInputs={[createFormInput()]}
        availableNodes={[
          {
            id: 'start',
            type: 'custom',
            position: { x: 0, y: 0 },
            data: {
              title: 'Start',
              desc: '',
              type: BlockEnum.Start,
            },
          },
        ]}
        nodesOutputVars={[
          {
            nodeId: 'start',
            title: 'Start',
            vars: [
              {
                variable: 'user_name',
                type: VarType.string,
              },
              {
                variable: 'score',
                type: VarType.number,
              },
            ],
          },
        ]}
      />,
    )

    const sendButton = screen.getByRole('button', {
      name: 'workflowHumanInput.nodes.humanInput.deliveryMethod.emailSender.send',
    })
    expect(sendButton).toBeDisabled()

    await user.type(screen.getByPlaceholderText('user_name'), 'Ada')
    await user.type(screen.getByPlaceholderText('score'), '42')
    expect(sendButton).toBeEnabled()

    await user.click(sendButton)

    await waitFor(() =>
      expect(
        screen.getByText('workflowHumanInput.nodes.humanInput.deliveryMethod.emailSender.done'),
      ).toBeInTheDocument(),
    )
    expect(requests).toContainEqual(
      expect.objectContaining({
        url: 'http://localhost:5001/console/api/apps/app-1/workflows/draft/human-input/nodes/human-node/delivery-test',
        method: 'POST',
        body: {
          delivery_method_id: 'delivery-1',
          inputs: {
            '#start.user_name#': 'Ada',
            '#start.score#': 42,
          },
        },
      }),
    )

    await user.click(screen.getByRole('button', { name: 'common.operation.ok' }))

    expect(handleOpenChange).toHaveBeenCalledWith(false)
  })

  it('should start a fresh session after closing and reopening', async () => {
    const user = userEvent.setup()
    const { requests } = setupFetch()
    renderWithProviders(<TestEmailSenderHarness />)

    await user.click(
      screen.getByRole('button', {
        name: 'workflowHumanInput.nodes.humanInput.deliveryMethod.emailSender.send',
      }),
    )
    expect(
      await screen.findByText(
        'workflowHumanInput.nodes.humanInput.deliveryMethod.emailSender.done',
      ),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'common.operation.ok' }))
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
    await user.click(screen.getByRole('button', { name: 'Open test email sender' }))

    expect(
      screen.getByRole('button', {
        name: 'workflowHumanInput.nodes.humanInput.deliveryMethod.emailSender.send',
      }),
    ).toBeInTheDocument()
    expect(
      screen.queryByText('workflowHumanInput.nodes.humanInput.deliveryMethod.emailSender.done'),
    ).not.toBeInTheDocument()

    await user.click(
      screen.getByRole('button', {
        name: 'workflowHumanInput.nodes.humanInput.deliveryMethod.emailSender.send',
      }),
    )
    await waitFor(() => {
      expect(
        requests.filter(
          (request) => request.method === 'POST' && request.url.endsWith('/delivery-test'),
        ),
      ).toHaveLength(2)
    })
  })

  it('should stay open when clicking outside the dialog', async () => {
    setupFetch()
    const user = userEvent.setup()
    const handleOpenChange = vi.fn()

    renderWithProviders(
      <EmailSenderModal
        nodeId="human-node"
        deliveryId="delivery-1"
        open
        onOpenChange={handleOpenChange}
        jumpToEmailConfigModal={vi.fn()}
        config={createConfig({ body: '' })}
      />,
    )

    await user.click(document.body)

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(handleOpenChange).not.toHaveBeenCalled()
  })

  it('should submit variables referenced by dynamic select option sources', async () => {
    const user = userEvent.setup()
    const { requests } = setupFetch()

    renderWithProviders(
      <EmailSenderModal
        nodeId="human-node"
        deliveryId="delivery-1"
        open
        onOpenChange={vi.fn()}
        jumpToEmailConfigModal={vi.fn()}
        config={createConfig({
          body: '{{#url#}}',
        })}
        formInputs={[createDynamicSelectInput()]}
        availableNodes={[
          {
            id: 'code',
            type: 'custom',
            position: { x: 0, y: 0 },
            data: {
              title: 'Code',
              desc: '',
              type: BlockEnum.Code,
              variables: [],
              code_language: CodeLanguage.python3,
              code: '',
              outputs: {
                result: {
                  type: VarType.arrayString,
                  children: null,
                },
              },
            } as CodeNodeType,
          },
        ]}
        nodesOutputVars={[
          {
            nodeId: 'code',
            title: 'Code',
            vars: [
              {
                variable: 'result',
                type: VarType.arrayString,
              },
            ],
          },
        ]}
      />,
    )

    const sendButton = screen.getByRole('button', {
      name: 'workflowHumanInput.nodes.humanInput.deliveryMethod.emailSender.send',
    })
    expect(sendButton).toBeDisabled()

    expect(screen.queryByPlaceholderText('result')).not.toBeInTheDocument()

    fireEvent.change(screen.getByTestId('monaco-editor'), {
      target: { value: '["approve","reject"]' },
    })
    expect(sendButton).toBeEnabled()

    await user.click(sendButton)

    await waitFor(() =>
      expect(requests).toContainEqual(
        expect.objectContaining({
          url: 'http://localhost:5001/console/api/apps/app-1/workflows/draft/human-input/nodes/human-node/delivery-test',
          method: 'POST',
          body: {
            delivery_method_id: 'delivery-1',
            inputs: {
              '#code.result#': ['approve', 'reject'],
            },
          },
        }),
      ),
    )
  })

  it('should render fallback variable inputs and allow cancelling', async () => {
    const user = userEvent.setup()
    const { requests } = setupFetch()
    const handleOpenChange = vi.fn()

    renderWithProviders(
      <EmailSenderModal
        nodeId="human-node"
        deliveryId="delivery-1"
        open
        onOpenChange={handleOpenChange}
        jumpToEmailConfigModal={vi.fn()}
        config={createConfig({
          body: 'Please review {{#unknown.message#}}',
        })}
      />,
    )

    expect(screen.getByPlaceholderText('message')).toBeInTheDocument()

    await user.click(
      screen.getByRole('button', {
        name: 'workflowHumanInput.nodes.humanInput.deliveryMethod.emailSender.vars',
      }),
    )

    expect(screen.queryByPlaceholderText('message')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))

    expect(handleOpenChange).toHaveBeenCalledWith(false)
    expect(requests.filter((request) => request.method === 'POST')).toEqual([])
  })

  it('should show a validation toast when generated JSON input is invalid', async () => {
    const user = userEvent.setup()
    const { requests } = setupFetch()

    renderWithProviders(
      <EmailSenderModal
        nodeId="human-node"
        deliveryId="delivery-1"
        open
        onOpenChange={vi.fn()}
        jumpToEmailConfigModal={vi.fn()}
        config={createConfig({
          body: 'Please review {{#code.payload#}}',
        })}
        availableNodes={[
          {
            id: 'code',
            type: 'custom',
            position: { x: 0, y: 0 },
            data: {
              title: 'Code',
              desc: '',
              type: BlockEnum.Code,
              variables: [],
              code_language: CodeLanguage.python3,
              code: '',
              outputs: {
                payload: {
                  type: VarType.object,
                  children: null,
                },
              },
            } as CodeNodeType,
          },
        ]}
        nodesOutputVars={[
          {
            nodeId: 'code',
            title: 'Code',
            vars: [
              {
                variable: 'payload',
                type: VarType.object,
              },
            ],
          },
        ]}
      />,
    )

    fireEvent.change(screen.getByTestId('monaco-editor'), {
      target: { value: '{invalid' },
    })
    await user.click(
      screen.getByRole('button', {
        name: 'workflowHumanInput.nodes.humanInput.deliveryMethod.emailSender.send',
      }),
    )

    expect(toast.error).toHaveBeenCalledWith('workflow.errorMsg.invalidJson:{"field":"payload"}')
    expect(requests).not.toContainEqual(
      expect.objectContaining({
        url: 'http://localhost:5001/console/api/apps/app-1/workflows/draft/human-input/nodes/human-node/delivery-test',
        method: 'POST',
      }),
    )
  })

  it('prevents duplicate delivery while the test email request is pending', async () => {
    const user = userEvent.setup()
    const pending = createDeferred<Response>()
    const { requests } = setupFetch(() => pending.promise)
    renderWithProviders(
      <EmailSenderModal
        nodeId="human-node"
        deliveryId="delivery-1"
        open
        onOpenChange={vi.fn()}
        jumpToEmailConfigModal={vi.fn()}
        config={createConfig({ body: 'Plain body' })}
      />,
    )
    const send = screen.getByRole('button', {
      name: 'workflowHumanInput.nodes.humanInput.deliveryMethod.emailSender.send',
    })
    await user.click(send)
    await waitFor(() =>
      expect(requests.filter((request) => request.method === 'POST')).toHaveLength(1),
    )
    expect(send).toHaveAttribute('aria-disabled', 'true')
    await user.click(send)
    expect(requests.filter((request) => request.method === 'POST')).toHaveLength(1)
    expect(
      screen.queryByText('workflowHumanInput.nodes.humanInput.deliveryMethod.emailSender.done'),
    ).not.toBeInTheDocument()
    await act(async () =>
      pending.resolve(
        new Response(JSON.stringify({ result: 'success' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    )
    expect(
      await screen.findByText(
        'workflowHumanInput.nodes.humanInput.deliveryMethod.emailSender.done',
      ),
    ).toBeInTheDocument()
  })

  it('should show debug success copy after sending in debug mode', async () => {
    const user = userEvent.setup()
    setupFetch()

    renderWithProviders(
      <EmailSenderModal
        nodeId="human-node"
        deliveryId="delivery-1"
        open
        onOpenChange={vi.fn()}
        jumpToEmailConfigModal={vi.fn()}
        config={createConfig({
          body: 'Plain body',
          debug_mode: true,
        })}
      />,
    )

    expect(
      screen.getByText(
        'workflowHumanInput.nodes.humanInput.deliveryMethod.emailSender.debugModeTip',
      ),
    ).toBeInTheDocument()

    await user.click(
      screen.getByRole('button', {
        name: 'workflowHumanInput.nodes.humanInput.deliveryMethod.emailSender.send',
      }),
    )

    await waitFor(() =>
      expect(
        screen.getByText(
          'workflowHumanInput.nodes.humanInput.deliveryMethod.emailSender.debugDone',
        ),
      ).toBeInTheDocument(),
    )
  })

  it('should show specific-recipient success copy after sending', async () => {
    const user = userEvent.setup()
    setupFetch()

    renderWithProviders(
      <EmailSenderModal
        nodeId="human-node"
        deliveryId="delivery-1"
        open
        onOpenChange={vi.fn()}
        jumpToEmailConfigModal={vi.fn()}
        config={createConfig({
          body: 'Plain body',
          recipients: {
            whole_workspace: false,
            items: [{ type: 'external', email: 'external@example.com' }],
          },
        })}
      />,
    )

    await user.click(
      screen.getByRole('button', {
        name: 'workflowHumanInput.nodes.humanInput.deliveryMethod.emailSender.send',
      }),
    )

    await waitFor(() =>
      expect(
        screen.getByText(
          'workflowHumanInput.nodes.humanInput.deliveryMethod.emailSender.wholeTeamDone3',
        ),
      ).toBeInTheDocument(),
    )
    expect(screen.getByText('external@example.com')).toBeInTheDocument()
  })
})
