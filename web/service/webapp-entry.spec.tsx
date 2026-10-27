import type { WebAppParametersResponse } from '@dify/contracts/api/web/types.gen'
import type { ReactNode } from 'react'
import type { WebAppAddress } from './webapp-address'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { useGetWebAppAccountStatus, useGetWebAppParams } from './use-share'
import { selectWebAppParameters } from './webapp-parameters'

vi.mock('@/app/notifications', () => ({ toast: { error: vi.fn() } }))

const parameters: WebAppParametersResponse = {
  account_login_enabled: true,
  account_login_url: '/signin',
  allow_anonymous_end_user_auth: false,
  workflow_id: 'published-workflow',
  requires_end_user_connections: true,
  connection_requirements: [
    {
      node_id: 'gmail-node',
      node_ids: ['gmail-node', 'reuse-node'],
      title: 'Read email',
      purpose: 'Find messages for this conversation',
      provider: 'langgenius/gmail/gmail',
      allowed_credential_types: ['oauth2'],
    },
  ],
  opening_statement: 'Welcome',
  annotation_reply: {},
  file_upload: {},
  more_like_this: {},
  retriever_resource: {},
  sensitive_word_avoidance: {},
  speech_to_text: { enabled: true },
  suggested_questions: ['Find email'],
  suggested_questions_after_answer: {},
  system_parameters: {
    audio_file_size_limit: 50,
    file_size_limit: 15,
    image_file_size_limit: 10,
    video_file_size_limit: 100,
    workflow_file_upload_limit: 10,
  },
  text_to_speech: {},
  user_input_form: [
    {
      'text-input': { label: 'Topic', variable: 'topic', required: true, default: 'Research' },
    },
  ],
}

describe('Web App entry queries', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    window.history.replaceState({}, '', '/chat/app-code')
  })

  afterEach(() => {
    queryClient.clear()
    vi.restoreAllMocks()
    window.history.replaceState({}, '', '/')
  })

  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )

  it('loads real account identity and retains connection requirements alongside the existing form config', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = new URL(input instanceof Request ? input.url : String(input))
      return Response.json(
        url.pathname.endsWith('/parameters')
          ? parameters
          : { logged_in: false, app_logged_in: true },
      )
    })
    const address = { kind: 'default', code: 'app-code' } as const
    const { result } = renderHook(
      () => ({
        parameters: useGetWebAppParams(address),
        account: useGetWebAppAccountStatus(address),
      }),
      { wrapper },
    )

    await waitFor(() => {
      expect(result.current.parameters.isSuccess).toBe(true)
      expect(result.current.account.isSuccess).toBe(true)
    })
    expect(result.current.parameters.data).toMatchObject({
      account_login_enabled: true,
      account_login_url: '/signin',
      allow_anonymous_end_user_auth: false,
      workflow_id: 'published-workflow',
      requires_end_user_connections: true,
      connection_requirements: parameters.connection_requirements,
      opening_statement: 'Welcome',
      speech_to_text: { enabled: true },
      user_input_form: parameters.user_input_form,
    })
    expect(result.current.account.data).toEqual({ logged_in: false, app_logged_in: true })
    const requests = fetch.mock.calls.map(
      ([input]) => new URL(input instanceof Request ? input.url : String(input)),
    )
    const loginRequest = requests.find((url) => url.pathname.endsWith('/login/status'))
    expect(loginRequest?.searchParams.get('mode')).toBe('end_user')
    expect(loginRequest?.searchParams.get('app_code')).toBe('app-code')
    expect(requests.filter((url) => url.pathname.endsWith('/parameters'))).toHaveLength(1)
  })

  it('checks the account within an environment without using the default App code query', async () => {
    window.history.replaceState({}, '', '/environment/chat/app-code')
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({
        logged_in: false,
        app_logged_in: true,
      }),
    )
    const { result } = renderHook(
      () =>
        useGetWebAppAccountStatus({
          kind: 'environment',
          code: 'app-code',
        }),
      { wrapper },
    )

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    const [input] = fetch.mock.calls[0]!
    const url = new URL(input instanceof Request ? input.url : String(input))
    expect(url.pathname).toMatch(/\/environment\/app-code\/login\/status$/)
    expect(url.searchParams.get('mode')).toBe('end_user')
    expect(url.searchParams.has('app_code')).toBe(false)
  })

  it('does not expose the previous App parameters or account while switching App scopes', async () => {
    const scopes: { path: string; address: WebAppAddress; workflow: string; loggedIn: boolean }[] =
      [
        {
          path: '/chat/app-code',
          address: { kind: 'default', code: 'app-code' },
          workflow: 'default-workflow',
          loggedIn: false,
        },
        {
          path: '/environment/chat/app-code',
          address: { kind: 'environment', code: 'app-code' },
          workflow: 'environment-workflow',
          loggedIn: true,
        },
        {
          path: '/environment/chat/another-code',
          address: { kind: 'environment', code: 'another-code' },
          workflow: 'another-workflow',
          loggedIn: false,
        },
      ]
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const scope = scopes.find(({ path }) => path === window.location.pathname)!
      const url = new URL(input instanceof Request ? input.url : String(input))
      return Response.json(
        url.pathname.endsWith('/parameters')
          ? { ...parameters, workflow_id: scope.workflow }
          : { logged_in: scope.loggedIn, app_logged_in: true },
      )
    })
    const { result, rerender } = renderHook(
      ({ address }: { address: WebAppAddress }) => ({
        parameters: useGetWebAppParams(address),
        account: useGetWebAppAccountStatus(address),
      }),
      { wrapper, initialProps: { address: scopes[0]!.address } },
    )

    for (const [index, scope] of scopes.entries()) {
      if (index > 0) {
        window.history.replaceState({}, '', scope.path)
        rerender({ address: scope.address })
        expect(result.current.parameters.data).toBeUndefined()
        expect(result.current.account.data).toBeUndefined()
      }
      await waitFor(() => {
        expect(result.current.parameters.data?.workflow_id).toBe(scope.workflow)
        expect(result.current.account.data?.logged_in).toBe(scope.loggedIn)
      })
    }
    expect(fetch).toHaveBeenCalledTimes(scopes.length * 2)
  })
})

describe('Web parameter compatibility', () => {
  it('keeps structured defaults for files and JSON input fields', () => {
    const file = {
      type: 'document',
      transfer_method: 'remote_url',
      url: 'https://example.com/report.pdf',
    }
    const config = selectWebAppParameters({
      ...parameters,
      user_input_form: [
        { file: { label: 'Report', variable: 'report', default: file } },
        { 'file-list': { label: 'Reports', variable: 'reports', default: [file] } },
        { json_object: { label: 'Settings', variable: 'settings', default: { language: 'en' } } },
      ],
    })

    expect(config.user_input_form).toMatchObject([
      { file: { default: file } },
      { 'file-list': { default: [file] } },
      { json_object: { default: { language: 'en' } } },
    ])
  })

  it.each([undefined, null, 5])(
    'keeps the existing file count behavior for max_length=%s',
    (maxLength) => {
      const config = selectWebAppParameters({
        ...parameters,
        user_input_form: [
          { 'file-list': { label: 'Reports', variable: 'reports', max_length: maxLength } },
        ],
      })

      expect(config.user_input_form).toMatchObject([
        { 'file-list': { max_length: maxLength ?? undefined } },
      ])
    },
  )
})
