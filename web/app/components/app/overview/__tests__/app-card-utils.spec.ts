import type { AppDetailResponse } from '@/models/app'
import { BlockEnum, InputVarType } from '@/app/components/workflow/types'
import { AccessMode } from '@/models/access-control'
import { AppModeEnum } from '@/types/app'
import { basePath } from '@/utils/var'
import {
  buildWorkflowLaunchUrl,
  compressAndEncodeBase64,
  createWorkflowLaunchInitialValues,
  getAppCardDisplayState,
  getAppCardOperationKeys,
  getAppHiddenLaunchVariables,
  getEmbeddedIframeSnippet,
  getEmbeddedScriptSnippet,
  getWorkflowHiddenStartVariables,
  hasWorkflowStartNode,
  isAppAccessConfigured,
  isWorkflowLaunchInputSupported,
} from '../app-card-utils'

describe('app-card-utils', () => {
  const baseAppInfo = {
    id: 'app-1',
    mode: AppModeEnum.CHAT,
    enable_site: true,
    enable_api: false,
    access_mode: AccessMode.PUBLIC,
    api_base_url: 'https://api.example.com',
    site: {
      app_base_url: 'https://example.com',
      access_token: 'token-1',
    },
  } as AppDetailResponse

  it('should detect whether the workflow includes a start node', () => {
    expect(hasWorkflowStartNode({
      graph: {
        nodes: [{ data: { type: BlockEnum.Start } }],
      },
    })).toBe(true)

    expect(hasWorkflowStartNode({
      graph: {
        nodes: [{ data: { type: BlockEnum.Answer } }],
      },
    })).toBe(false)
  })

  it('should return hidden workflow start variables and their initial launch values', () => {
    const hiddenVariables = getWorkflowHiddenStartVariables({
      graph: {
        nodes: [{
          data: {
            type: BlockEnum.Start,
            variables: [
              {
                variable: 'visible',
                label: 'Visible',
                type: InputVarType.textInput,
                hide: false,
                required: false,
              },
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
            ],
          },
        }],
      },
    })

    expect(hiddenVariables.map(variable => variable.variable)).toEqual(['secret', 'enabled'])
    expect(createWorkflowLaunchInitialValues(hiddenVariables)).toEqual({
      secret: 'prefilled',
      enabled: true,
    })
  })

  it('should return hidden advanced-chat launch variables from the workflow start node first', () => {
    const hiddenVariables = getAppHiddenLaunchVariables({
      appInfo: {
        ...baseAppInfo,
        mode: AppModeEnum.ADVANCED_CHAT,
        model_config: {
          user_input_form: [
            {
              'text-input': {
                label: 'Visible',
                variable: 'visible',
                required: true,
                max_length: 48,
                default: '',
                hide: false,
              },
            },
            {
              checkbox: {
                label: 'Hidden Toggle',
                variable: 'hidden_toggle',
                required: false,
                default: true,
                hide: true,
              },
            },
          ],
        },
      } as AppDetailResponse,
      currentWorkflow: {
        graph: {
          nodes: [{
            data: {
              type: BlockEnum.Start,
              variables: [
                {
                  variable: 'start_secret',
                  label: 'Start Secret',
                  type: InputVarType.textInput,
                  hide: true,
                  default: 'from-start',
                  required: false,
                },
              ],
            },
          }],
        },
      },
    })

    expect(hiddenVariables).toEqual([
      expect.objectContaining({
        variable: 'start_secret',
        type: InputVarType.textInput,
        default: 'from-start',
      }),
    ])
  })

  it('should build the display state for a published web app', () => {
    const state = getAppCardDisplayState({
      appInfo: baseAppInfo,
      cardType: 'webapp',
      currentWorkflow: null,
      isCurrentWorkspaceEditor: true,
      isCurrentWorkspaceManager: true,
    })

    expect(state.isApp).toBe(true)
    expect(state.appMode).toBe(AppModeEnum.CHAT)
    expect(state.runningStatus).toBe(true)
    expect(state.accessibleUrl).toBe(`https://example.com${basePath}/chat/token-1`)
  })

  it('should disable workflow cards without a graph or start node', () => {
    const unpublishedState = getAppCardDisplayState({
      appInfo: { ...baseAppInfo, mode: AppModeEnum.WORKFLOW },
      cardType: 'webapp',
      currentWorkflow: null,
      isCurrentWorkspaceEditor: true,
      isCurrentWorkspaceManager: true,
    })
    expect(unpublishedState.appUnpublished).toBe(true)
    expect(unpublishedState.toggleDisabled).toBe(true)

    const missingStartState = getAppCardDisplayState({
      appInfo: { ...baseAppInfo, mode: AppModeEnum.WORKFLOW },
      cardType: 'webapp',
      currentWorkflow: {
        graph: {
          nodes: [{ data: { type: BlockEnum.Answer } }],
        },
      },
      isCurrentWorkspaceEditor: true,
      isCurrentWorkspaceManager: true,
    })
    expect(missingStartState.missingStartNode).toBe(true)
    expect(missingStartState.runningStatus).toBe(false)
  })

  it('should require specific access subjects only for the specific access mode', () => {
    expect(isAppAccessConfigured(
      { ...baseAppInfo, access_mode: AccessMode.PUBLIC },
      { groups: [], members: [] },
    )).toBe(true)

    expect(isAppAccessConfigured(
      { ...baseAppInfo, access_mode: AccessMode.SPECIFIC_GROUPS_MEMBERS },
      { groups: [], members: [] },
    )).toBe(false)

    expect(isAppAccessConfigured(
      { ...baseAppInfo, access_mode: AccessMode.SPECIFIC_GROUPS_MEMBERS },
      { groups: [{ id: 'group-1' }], members: [] },
    )).toBe(true)
  })

  it('should derive operation keys for api and webapp cards', () => {
    expect(getAppCardOperationKeys({
      cardType: 'api',
      appMode: AppModeEnum.COMPLETION,
      isCurrentWorkspaceEditor: true,
    })).toEqual(['develop'])

    expect(getAppCardOperationKeys({
      cardType: 'webapp',
      appMode: AppModeEnum.CHAT,
      isCurrentWorkspaceEditor: false,
    })).toEqual(['launch', 'embedded', 'customize'])
  })

  it('should build a workflow launch URL with serialized parameters', async () => {
    const url = await buildWorkflowLaunchUrl({
      accessibleUrl: 'https://example.com/app/workflow/token-1',
      variables: [
        { variable: 'name', label: 'Name', type: InputVarType.textInput, hide: true, required: false },
        { variable: 'enabled', label: 'Enabled', type: InputVarType.checkbox, hide: true, required: false },
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
        { variable: 'flag', label: 'Flag', type: InputVarType.checkbox, hide: true, required: false },
        { variable: 'empty', label: 'Empty', type: InputVarType.textInput, hide: true, required: false },
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
    expect(snippet).toContain('allow="microphone"')
  })

  it('should generate an embedded script snippet with inputs', () => {
    const snippet = getEmbeddedScriptSnippet({
      url: 'https://example.com',
      token: 'abc123',
      primaryColor: '#FF0000',
      isTestEnv: true,
      inputValues: { name: 'Alice', count: '5' },
    })

    expect(snippet).toContain('token: \'abc123\'')
    expect(snippet).toContain('isDev: true')
    expect(snippet).toContain('name: "Alice"')
    expect(snippet).toContain('count: "5"')
    expect(snippet).toContain('background-color: #FF0000')
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
    expect(isWorkflowLaunchInputSupported({ variable: 'v', label: 'V', type: InputVarType.textInput, hide: true, required: false })).toBe(true)
    expect(isWorkflowLaunchInputSupported({ variable: 'v', label: 'V', type: InputVarType.paragraph, hide: true, required: false })).toBe(true)
    expect(isWorkflowLaunchInputSupported({ variable: 'v', label: 'V', type: InputVarType.select, hide: true, required: false })).toBe(true)
    expect(isWorkflowLaunchInputSupported({ variable: 'v', label: 'V', type: InputVarType.number, hide: true, required: false })).toBe(true)
    expect(isWorkflowLaunchInputSupported({ variable: 'v', label: 'V', type: InputVarType.checkbox, hide: true, required: false })).toBe(true)
    expect(isWorkflowLaunchInputSupported({ variable: 'v', label: 'V', type: InputVarType.json, hide: true, required: false })).toBe(true)
    expect(isWorkflowLaunchInputSupported({ variable: 'v', label: 'V', type: InputVarType.jsonObject, hide: true, required: false })).toBe(true)
    expect(isWorkflowLaunchInputSupported({ variable: 'v', label: 'V', type: InputVarType.url, hide: true, required: false })).toBe(true)
    expect(isWorkflowLaunchInputSupported({ variable: 'v', label: 'V', type: InputVarType.files, hide: true, required: false })).toBe(false)
    expect(isWorkflowLaunchInputSupported({ variable: 'v', label: 'V', type: InputVarType.singleFile, hide: true, required: false })).toBe(false)
  })

  it('should coerce numeric defaults to string in createWorkflowLaunchInitialValues', () => {
    const result = createWorkflowLaunchInitialValues([
      { variable: 'count', label: 'Count', type: InputVarType.number, hide: true, required: false, default: 42 },
      { variable: 'empty', label: 'Empty', type: InputVarType.textInput, hide: true, required: false },
    ])

    expect(result).toEqual({ count: '42', empty: '' })
  })
})
