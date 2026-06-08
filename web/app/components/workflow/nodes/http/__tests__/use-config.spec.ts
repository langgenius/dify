import type { HttpNodeType } from '../types'
import { act, renderHook, waitFor } from '@testing-library/react'
import { useNodesReadOnly } from '@/app/components/workflow/hooks'
import useNodeCrud from '@/app/components/workflow/nodes/_base/hooks/use-node-crud'
import { useStore } from '@/app/components/workflow/store'
import { BlockEnum, VarType } from '@/app/components/workflow/types'
import useVarList from '../../_base/hooks/use-var-list'
import useKeyValueList from '../hooks/use-key-value-list'
import { APIType, AuthorizationType, BodyPayloadValueType, BodyType, Method } from '../types'
import useConfig from '../use-config'

vi.mock('@/app/components/workflow/hooks', () => ({
  useNodesReadOnly: vi.fn(),
}))

vi.mock('@/app/components/workflow/nodes/_base/hooks/use-node-crud', () => ({
  __esModule: true,
  default: vi.fn(),
}))

vi.mock('@/app/components/workflow/nodes/_base/hooks/use-var-list', () => ({
  __esModule: true,
  default: vi.fn(),
}))

vi.mock('../hooks/use-key-value-list', () => ({
  __esModule: true,
  default: vi.fn(),
}))

vi.mock('@/app/components/workflow/store', () => ({
  useStore: vi.fn(),
}))

const mockUseNodesReadOnly = vi.mocked(useNodesReadOnly)
const mockUseNodeCrud = vi.mocked(useNodeCrud)
const mockUseVarList = vi.mocked(useVarList)
const mockUseKeyValueList = vi.mocked(useKeyValueList)
const mockUseStore = vi.mocked(useStore)

const createPayload = (overrides: Partial<HttpNodeType> = {}): HttpNodeType => ({
  title: 'HTTP Request',
  desc: '',
  type: BlockEnum.HttpRequest,
  variables: [],
  method: Method.get,
  url: 'https://api.example.com',
  authorization: { type: AuthorizationType.none },
  headers: 'accept:application/json',
  params: 'page:1',
  body: {
    type: BodyType.json,
    data: '{"name":"alice"}',
  },
  timeout: { connect: 5, read: 10, write: 15 },
  ssl_verify: true,
  ...overrides,
})

describe('http/use-config', () => {
  const mockSetInputs = vi.fn()
  const mockHandleVarListChange = vi.fn()
  const mockHandleAddVariable = vi.fn()
  const headerSetList = vi.fn()
  const headerAddItem = vi.fn()
  const headerToggle = vi.fn()
  const paramSetList = vi.fn()
  const paramAddItem = vi.fn()
  const paramToggle = vi.fn()
  let currentInputs: HttpNodeType
  let headerFieldChange: ((value: string) => void) | undefined
  let paramFieldChange: ((value: string) => void) | undefined

  beforeEach(() => {
    vi.clearAllMocks()
    currentInputs = createPayload()
    headerFieldChange = undefined
    paramFieldChange = undefined

    mockUseNodesReadOnly.mockReturnValue({ nodesReadOnly: false, getNodesReadOnly: () => false })
    mockUseNodeCrud.mockImplementation(() => ({
      inputs: currentInputs,
      setInputs: mockSetInputs,
    }))
    mockUseVarList.mockReturnValue({
      handleVarListChange: mockHandleVarListChange,
      handleAddVariable: mockHandleAddVariable,
    } as ReturnType<typeof useVarList>)
    mockUseKeyValueList.mockImplementation((value, onChange) => {
      if (value === currentInputs.headers) {
        headerFieldChange = onChange
        return {
          list: [{ id: 'header-1', key: 'accept', value: 'application/json' }],
          setList: headerSetList,
          addItem: headerAddItem,
          isKeyValueEdit: true,
          toggleIsKeyValueEdit: headerToggle,
        }
      }

      paramFieldChange = onChange
      return {
        list: [{ id: 'param-1', key: 'page', value: '1' }],
        setList: paramSetList,
        addItem: paramAddItem,
        isKeyValueEdit: false,
        toggleIsKeyValueEdit: paramToggle,
      }
    })
    mockUseStore.mockImplementation((selector) => {
      const state = {
        nodesDefaultConfigs: {
          [BlockEnum.HttpRequest]: createPayload({
            method: Method.post,
            url: 'https://default.example.com',
            headers: '',
            params: '',
            body: { type: BodyType.none, data: [] },
            timeout: { connect: 1, read: 2, write: 3 },
            ssl_verify: false,
          }),
        },
      }

      return selector(state as never)
    })
  })

  it('stays pending when the node default config is unavailable', () => {
    mockUseStore.mockImplementation((selector) => {
      return selector({ nodesDefaultConfigs: {} } as never)
    })

    const { result } = renderHook(() => useConfig('http-node', currentInputs))

    expect(result.current.isDataReady).toBe(false)
    expect(mockSetInputs).not.toHaveBeenCalled()
  })

  it('hydrates defaults, normalizes body payloads, and exposes var-list and key-value helpers', async () => {
    const { result } = renderHook(() => useConfig('http-node', currentInputs))

    await waitFor(() => {
      expect(mockSetInputs).toHaveBeenCalledWith(expect.objectContaining({
        method: Method.get,
        url: 'https://api.example.com',
        body: {
          type: BodyType.json,
          data: [{
            type: BodyPayloadValueType.text,
            value: '{"name":"alice"}',
          }],
        },
        ssl_verify: true,
      }))
    })

    expect(result.current.isDataReady).toBe(true)
    expect(result.current.readOnly).toBe(false)
    expect(result.current.handleVarListChange).toBe(mockHandleVarListChange)
    expect(result.current.handleAddVariable).toBe(mockHandleAddVariable)
    expect(result.current.headers).toEqual([{ id: 'header-1', key: 'accept', value: 'application/json' }])
    expect(result.current.setHeaders).toBe(headerSetList)
    expect(result.current.addHeader).toBe(headerAddItem)
    expect(result.current.isHeaderKeyValueEdit).toBe(true)
    expect(result.current.toggleIsHeaderKeyValueEdit).toBe(headerToggle)
    expect(result.current.params).toEqual([{ id: 'param-1', key: 'page', value: '1' }])
    expect(result.current.setParams).toBe(paramSetList)
    expect(result.current.addParam).toBe(paramAddItem)
    expect(result.current.isParamKeyValueEdit).toBe(false)
    expect(result.current.toggleIsParamKeyValueEdit).toBe(paramToggle)
    expect(result.current.filterVar({ type: VarType.string } as never)).toBe(true)
    expect(result.current.filterVar({ type: VarType.number } as never)).toBe(true)
    expect(result.current.filterVar({ type: VarType.secret } as never)).toBe(true)
    expect(result.current.filterVar({ type: VarType.file } as never)).toBe(false)
  })

  it('initializes empty body data arrays when the payload body is missing', async () => {
    currentInputs = createPayload({
      body: {
        type: BodyType.formData,
        data: undefined as unknown as HttpNodeType['body']['data'],
      },
    })

    renderHook(() => useConfig('http-node', currentInputs))

    await waitFor(() => {
      expect(mockSetInputs).toHaveBeenCalledWith(expect.objectContaining({
        body: {
          type: BodyType.formData,
          data: [],
        },
      }))
    })
  })

  it('updates request fields, authorization state, curl imports, and ssl verification', async () => {
    const { result } = renderHook(() => useConfig('http-node', currentInputs))

    await waitFor(() => {
      expect(result.current.isDataReady).toBe(true)
    })

    mockSetInputs.mockClear()

    act(() => {
      result.current.handleMethodChange(Method.delete)
      result.current.handleUrlChange('https://changed.example.com')
      headerFieldChange?.('x-token:123')
      paramFieldChange?.('size:20')
      result.current.setBody({ type: BodyType.rawText, data: 'raw payload' })
      result.current.showAuthorization()
    })

    expect(result.current.isShowAuthorization).toBe(true)

    act(() => {
      result.current.hideAuthorization()
      result.current.setAuthorization({
        type: AuthorizationType.apiKey,
        config: {
          type: APIType.bearer,
          api_key: 'secret',
        },
      })
      result.current.setTimeout({ connect: 30, read: 40, write: 50 })
      result.current.showCurlPanel()
    })

    expect(result.current.isShowCurlPanel).toBe(true)

    act(() => {
      result.current.hideCurlPanel()
      result.current.handleCurlImport(createPayload({
        method: Method.patch,
        url: 'https://imported.example.com',
        headers: 'authorization:Bearer imported',
        params: 'debug:true',
        body: { type: BodyType.json, data: [{ type: BodyPayloadValueType.text, value: '{"ok":true}' }] },
      }))
      result.current.handleSSLVerifyChange(false)
    })

    expect(result.current.isShowAuthorization).toBe(false)
    expect(result.current.isShowCurlPanel).toBe(false)
    expect(mockSetInputs).toHaveBeenCalledWith(expect.objectContaining({ method: Method.delete }))
    expect(mockSetInputs).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://changed.example.com' }))
    expect(mockSetInputs).toHaveBeenCalledWith(expect.objectContaining({ headers: 'x-token:123' }))
    expect(mockSetInputs).toHaveBeenCalledWith(expect.objectContaining({ params: 'size:20' }))
    expect(mockSetInputs).toHaveBeenCalledWith(expect.objectContaining({
      body: { type: BodyType.rawText, data: 'raw payload' },
    }))
    expect(mockSetInputs).toHaveBeenCalledWith(expect.objectContaining({
      authorization: expect.objectContaining({
        type: AuthorizationType.apiKey,
      }),
    }))
    expect(mockSetInputs).toHaveBeenCalledWith(expect.objectContaining({
      timeout: { connect: 30, read: 40, write: 50 },
    }))
    expect(mockSetInputs).toHaveBeenCalledWith(expect.objectContaining({
      method: Method.patch,
      url: 'https://imported.example.com',
      headers: 'authorization:Bearer imported',
      params: 'debug:true',
      body: { type: BodyType.json, data: [{ type: BodyPayloadValueType.text, value: '{"ok":true}' }] },
    }))
    expect(mockSetInputs).toHaveBeenCalledWith(expect.objectContaining({ ssl_verify: false }))
  })
})
