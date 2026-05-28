import type { ReactNode } from 'react'
import type { EmailConfig, FormInputItem } from '../../../types'
import type { App, AppSSO } from '@/types/app'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useStore as useAppStore } from '@/app/components/app/store'
import { HooksStoreContext } from '@/app/components/workflow/hooks-store/provider'
import { createHooksStore } from '@/app/components/workflow/hooks-store/store'
import { BlockEnum, InputVarType, VarType } from '@/app/components/workflow/types'
import { AppContext, initialLangGeniusVersionInfo, initialWorkspaceInfo, userProfilePlaceholder } from '@/context/app-context'
import EmailSenderModal from '../test-email-sender'

type RecordedRequest = {
  url: string
  method: string
  body?: unknown
}

const createQueryClient = () => new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
})

const renderWithProviders = (ui: ReactNode) => {
  const queryClient = createQueryClient()
  const hooksStore = createHooksStore({})

  return render(
    <QueryClientProvider client={queryClient}>
      <AppContext.Provider
        value={{
          userProfile: {
            ...userProfilePlaceholder,
            id: 'user-1',
            email: 'owner@example.com',
            name: 'Owner',
          },
          currentWorkspace: {
            ...initialWorkspaceInfo,
            id: 'workspace-1',
            name: 'Product Team',
          },
          isCurrentWorkspaceManager: true,
          isCurrentWorkspaceOwner: true,
          isCurrentWorkspaceEditor: true,
          isCurrentWorkspaceDatasetOperator: true,
          mutateUserProfile: vi.fn(),
          mutateCurrentWorkspace: vi.fn(),
          langGeniusVersionInfo: initialLangGeniusVersionInfo,
          useSelector: selector => selector({
            userProfile: {
              ...userProfilePlaceholder,
              id: 'user-1',
              email: 'owner@example.com',
              name: 'Owner',
            },
            currentWorkspace: {
              ...initialWorkspaceInfo,
              id: 'workspace-1',
              name: 'Product Team',
            },
            isCurrentWorkspaceManager: true,
            isCurrentWorkspaceOwner: true,
            isCurrentWorkspaceEditor: true,
            isCurrentWorkspaceDatasetOperator: true,
            mutateUserProfile: vi.fn(),
            mutateCurrentWorkspace: vi.fn(),
            langGeniusVersionInfo: initialLangGeniusVersionInfo,
            useSelector: vi.fn(),
            isLoadingCurrentWorkspace: false,
            isValidatingCurrentWorkspace: false,
          }),
          isLoadingCurrentWorkspace: false,
          isValidatingCurrentWorkspace: false,
        }}
      >
        <HooksStoreContext.Provider value={hooksStore}>
          {ui}
        </HooksStoreContext.Provider>
      </AppContext.Provider>
    </QueryClientProvider>,
  )
}

const setupFetch = () => {
  const requests: RecordedRequest[] = []
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (resource: RequestInfo | URL, options?: RequestInit) => {
    const request = resource instanceof Request ? resource : new Request(resource, options)
    const body = request.method === 'GET' ? undefined : await request.clone().json()
    requests.push({
      url: request.url,
      method: request.method,
      body,
    })

    if (request.url.includes('/workspaces/current/members')) {
      return new Response(JSON.stringify({
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
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

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

const createFormInput = (overrides: Partial<FormInputItem> = {}): FormInputItem => ({
  type: InputVarType.textInput,
  output_variable_name: 'user_name',
  default: {
    type: 'variable',
    selector: ['start', 'user_name'],
    value: '',
  },
  ...overrides,
})

describe('human-input/delivery-method/test-email-sender', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAppStore.setState({
      appDetail: {
        id: 'app-1',
        name: 'Workflow App',
      } as App & Partial<AppSSO>,
    })
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

    const sendButton = screen.getByRole('button', { name: 'workflow.nodes.humanInput.deliveryMethod.emailSender.send' })
    expect(sendButton).toBeDisabled()

    await user.type(screen.getByPlaceholderText('user_name'), 'Ada')
    await user.type(screen.getByPlaceholderText('score'), '42')
    expect(sendButton).toBeEnabled()

    await user.click(sendButton)

    await waitFor(() => expect(screen.getByText('workflow.nodes.humanInput.deliveryMethod.emailSender.done')).toBeInTheDocument())
    expect(requests).toContainEqual(expect.objectContaining({
      url: 'http://localhost:5001/console/api/apps/app-1/workflows/draft/human-input/nodes/human-node/delivery-test',
      method: 'POST',
      body: {
        delivery_method_id: 'delivery-1',
        inputs: {
          '#start.user_name#': 'Ada',
          '#start.score#': '42',
        },
      },
    }))

    await user.click(screen.getByRole('button', { name: 'common.operation.ok' }))

    expect(handleOpenChange).toHaveBeenCalledWith(false)
  })

  it('should render fallback variable inputs and allow cancelling', async () => {
    const user = userEvent.setup()
    setupFetch()
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

    await user.click(screen.getByRole('button', { name: 'workflow.nodes.humanInput.deliveryMethod.emailSender.vars' }))

    expect(screen.queryByPlaceholderText('message')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'common.operation.cancel' }))

    expect(handleOpenChange).toHaveBeenCalledWith(false)
  })

  it('should show selected recipients with the email configuration tip', () => {
    setupFetch()

    renderWithProviders(
      <EmailSenderModal
        nodeId="human-node"
        deliveryId="delivery-1"
        open
        onOpenChange={vi.fn()}
        jumpToEmailConfigModal={vi.fn()}
        config={createConfig({
          recipients: {
            whole_workspace: true,
            items: [{ type: 'external', email: 'external@example.com' }],
          },
          body: 'Please review {{#url#}}',
        })}
      />,
    )

    expect(screen.getByText('external@example.com')).toBeInTheDocument()
    expect(screen.getByText('nodes.humanInput.deliveryMethod.emailSender.tip')).toBeInTheDocument()
  })
})
