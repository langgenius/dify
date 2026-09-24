import { InputVarType } from '@/app/components/workflow/types'
import { basePath } from '@/utils/var'
import {
  buildWorkflowLaunchUrl,
  compressAndEncodeBase64,
  createWorkflowLaunchInitialValues,
  getEmbeddedIframeSnippet,
  getEmbeddedScriptSnippet,
  isWorkflowLaunchInputSupported,
} from '../app-card-utils'

describe('app-card-utils', () => {
  it('should create initial values from workflow launch defaults', () => {
    expect(
      createWorkflowLaunchInitialValues([
        {
          variable: 'secret',
          label: 'Secret',
          type: InputVarType.textInput,
          hide: true,
          default: 'prefilled',
          required: false,
        },
        {
          variable: 'enabled',
          label: 'Enabled',
          type: InputVarType.checkbox,
          hide: true,
          default: true,
          required: false,
        },
      ]),
    ).toEqual({
      secret: 'prefilled',
      enabled: true,
    })
  })

  it('should build a workflow launch URL with serialized parameters', async () => {
    const url = await buildWorkflowLaunchUrl({
      accessibleUrl: 'https://example.com/app/workflow/token-1',
      variables: [
        {
          variable: 'name',
          label: 'Name',
          type: InputVarType.textInput,
          hide: true,
          required: false,
        },
        {
          variable: 'enabled',
          label: 'Enabled',
          type: InputVarType.checkbox,
          hide: true,
          required: false,
        },
      ],
      values: { name: 'Alice', enabled: true },
    })

    const parsed = new URL(url)
    expect(parsed.searchParams.get('name')).toBe('Alice')
    expect(parsed.searchParams.get('enabled')).toBe('true')
  })

  it('should serialize checkbox false and empty string values in launch URL', async () => {
    const url = await buildWorkflowLaunchUrl({
      accessibleUrl: 'https://example.com/app/workflow/token-1',
      variables: [
        {
          variable: 'flag',
          label: 'Flag',
          type: InputVarType.checkbox,
          hide: true,
          required: false,
        },
        {
          variable: 'empty',
          label: 'Empty',
          type: InputVarType.textInput,
          hide: true,
          required: false,
        },
      ],
      values: { flag: false, empty: '' },
    })

    const parsed = new URL(url)
    expect(parsed.searchParams.get('flag')).toBe('false')
    expect(parsed.searchParams.get('empty')).toBe('')
  })

  it('should generate an iframe snippet with the provided URL', () => {
    const snippet = getEmbeddedIframeSnippet('https://example.com/chatbot/token-1')
    expect(snippet).toContain('src="https://example.com/chatbot/token-1"')
    expect(snippet).toContain('frameborder="0"')
    expect(snippet).toContain('allow="microphone;clipboard-write"')
  })

  it('should generate an embedded script snippet with inputs', () => {
    const snippet = getEmbeddedScriptSnippet({
      url: 'https://example.com',
      token: 'abc123',
      primaryColor: '#FF0000',
      isTestEnv: true,
      inputValues: { name: 'Alice', count: '5' },
    })

    expect(snippet).toContain("token: 'abc123'")
    expect(snippet).toContain('isDev: true')
    expect(snippet).toContain('name: "Alice"')
    expect(snippet).toContain('count: "5"')
    expect(snippet).toContain('background-color: #FF0000')
    expect(snippet).toContain(`baseUrl: 'https://example.com${basePath}'`)
  })

  it('should generate an embedded script snippet with empty inputs comment', () => {
    const snippet = getEmbeddedScriptSnippet({
      url: 'https://example.com',
      token: 'abc123',
      primaryColor: '#1C64F2',
      inputValues: {},
    })

    expect(snippet).toContain('// You can define the inputs from the Start node here')
    expect(snippet).not.toContain('isDev: true')
  })

  it('should generate an agent embedded script route when requested', () => {
    const snippet = getEmbeddedScriptSnippet({
      url: 'https://example.com',
      token: 'agent-token',
      webAppRoute: 'agent',
      primaryColor: '#1C64F2',
      inputValues: {},
    })

    expect(snippet).toContain("routeSegment: 'agent'")
  })

  it('should compress and encode base64 using CompressionStream when available', async () => {
    const result = await compressAndEncodeBase64('hello')
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)
  })

  it('should fallback to plain base64 when CompressionStream is unavailable', async () => {
    const original = globalThis.CompressionStream
    // @ts-expect-error remove for test
    delete globalThis.CompressionStream

    const result = await compressAndEncodeBase64('hello')
    expect(result).toBe(btoa('hello'))

    globalThis.CompressionStream = original
  })

  it('should identify supported workflow launch input types', () => {
    expect(
      isWorkflowLaunchInputSupported({
        variable: 'v',
        label: 'V',
        type: InputVarType.textInput,
        hide: true,
        required: false,
      }),
    ).toBe(true)
    expect(
      isWorkflowLaunchInputSupported({
        variable: 'v',
        label: 'V',
        type: InputVarType.paragraph,
        hide: true,
        required: false,
      }),
    ).toBe(true)
    expect(
      isWorkflowLaunchInputSupported({
        variable: 'v',
        label: 'V',
        type: InputVarType.select,
        hide: true,
        required: false,
      }),
    ).toBe(true)
    expect(
      isWorkflowLaunchInputSupported({
        variable: 'v',
        label: 'V',
        type: InputVarType.number,
        hide: true,
        required: false,
      }),
    ).toBe(true)
    expect(
      isWorkflowLaunchInputSupported({
        variable: 'v',
        label: 'V',
        type: InputVarType.checkbox,
        hide: true,
        required: false,
      }),
    ).toBe(true)
    expect(
      isWorkflowLaunchInputSupported({
        variable: 'v',
        label: 'V',
        type: InputVarType.json,
        hide: true,
        required: false,
      }),
    ).toBe(true)
    expect(
      isWorkflowLaunchInputSupported({
        variable: 'v',
        label: 'V',
        type: InputVarType.jsonObject,
        hide: true,
        required: false,
      }),
    ).toBe(true)
    expect(
      isWorkflowLaunchInputSupported({
        variable: 'v',
        label: 'V',
        type: InputVarType.url,
        hide: true,
        required: false,
      }),
    ).toBe(true)
    expect(
      isWorkflowLaunchInputSupported({
        variable: 'v',
        label: 'V',
        type: InputVarType.files,
        hide: true,
        required: false,
      }),
    ).toBe(false)
    expect(
      isWorkflowLaunchInputSupported({
        variable: 'v',
        label: 'V',
        type: InputVarType.singleFile,
        hide: true,
        required: false,
      }),
    ).toBe(false)
  })

  it('should coerce numeric defaults to string in createWorkflowLaunchInitialValues', () => {
    const result = createWorkflowLaunchInitialValues([
      {
        variable: 'count',
        label: 'Count',
        type: InputVarType.number,
        hide: true,
        required: false,
        default: 42,
      },
      {
        variable: 'empty',
        label: 'Empty',
        type: InputVarType.textInput,
        hide: true,
        required: false,
      },
    ])

    expect(result).toEqual({ count: '42', empty: '' })
  })
})
