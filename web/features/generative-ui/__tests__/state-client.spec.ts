import type { GenerativeUIStateTarget } from '../state-client'
import { saveGenerativeUIState } from '../state-client'

const formState = { filters: { region: { value: 'West' } } }
const block = {
  id: 'openui:llm:1',
  type: 'openui',
  library_version: 'dify-ui-v1',
  text_offset: 0,
  source: 'root = Stack([])',
  status: 'completed',
  sequence: 2,
  form_state: formState,
}

describe('generated OpenUI state clients', () => {
  afterEach(() => vi.unstubAllGlobals())

  it.each<{ target: GenerativeUIStateTarget; suffix: string }>([
    {
      target: { kind: 'app', appId: 'app-1' },
      suffix: '/apps/app-1/messages/message-1/content-blocks/openui%3Allm%3A1/state',
    },
    {
      target: { kind: 'agent', agentId: 'agent-1' },
      suffix: '/agent/agent-1/messages/message-1/content-blocks/openui%3Allm%3A1/state',
    },
    {
      target: { kind: 'installed-app', installedAppId: 'installed-1' },
      suffix:
        '/installed-apps/installed-1/messages/message-1/content-blocks/openui%3Allm%3A1/state',
    },
    {
      target: { kind: 'webapp' },
      suffix: '/messages/message-1/content-blocks/openui%3Allm%3A1/state',
    },
  ])(
    'saves scoped state for $target.kind with an encoded content block ID',
    async ({ target, suffix }) => {
      let capturedRequest: Request | undefined
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
          capturedRequest = new Request(input, init)
          return Response.json({ block })
        }),
      )
      const result = await saveGenerativeUIState(target, 'message-1', block.id, formState)

      expect(capturedRequest?.method).toBe('PUT')
      expect(new URL(capturedRequest!.url).pathname.endsWith(suffix)).toBe(true)
      expect(await capturedRequest!.json()).toEqual({ form_state: formState })
      expect(result.block).toEqual(block)
    },
  )

  it('uses the environment app path for a deployed webapp', async () => {
    vi.stubGlobal('location', {
      origin: 'https://example.com',
      pathname: '/environment/chatbot/staging',
      search: '',
    })
    const fetchRequest = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      Response.json({ block }),
    )
    vi.stubGlobal('fetch', fetchRequest)

    await saveGenerativeUIState({ kind: 'webapp' }, 'message-1', block.id, formState)

    const request = fetchRequest.mock.calls[0]?.[0] as Request
    expect(new URL(request.url).pathname).toContain(
      '/environment/staging/messages/message-1/content-blocks/',
    )
  })
})
