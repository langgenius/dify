import type { ReactNode } from 'react'
import type { HttpNodeType } from '../types'
import type { NodePanelProps } from '@/app/components/workflow/types'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BlockEnum } from '@/app/components/workflow/types'
import Panel from '../panel'
import { AuthorizationType, BodyPayloadValueType, BodyType, Method } from '../types'

const mockUseConfig = vi.hoisted(() => vi.fn())
const mockAuthorizationModal = vi.hoisted(() => vi.fn())
const mockCurlPanel = vi.hoisted(() => vi.fn())
const mockApiInput = vi.hoisted(() => vi.fn())
const mockKeyValue = vi.hoisted(() => vi.fn())
const mockEditBody = vi.hoisted(() => vi.fn())
const mockTimeout = vi.hoisted(() => vi.fn())

type ApiInputProps = {
  method: Method
  url: string
  onMethodChange: (method: Method) => void
  onUrlChange: (url: string) => void
}

type KeyValueProps = {
  nodeId: string
  list: Array<{ key: string, value: string }>
  onChange: (value: Array<{ key: string, value: string }>) => void
  onAdd: () => void
}

type EditBodyProps = {
  payload: HttpNodeType['body']
  onChange: (value: HttpNodeType['body']) => void
}

type TimeoutProps = {
  payload: HttpNodeType['timeout']
  onChange: (value: HttpNodeType['timeout']) => void
}

vi.mock('../use-config', () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockUseConfig(...args),
}))

vi.mock('../components/authorization', () => ({
  __esModule: true,
  default: (props: { nodeId: string, payload: HttpNodeType['authorization'], onChange: (value: HttpNodeType['authorization']) => void, onHide: () => void }) => {
    mockAuthorizationModal(props)
    return <div data-testid="authorization-modal">{props.nodeId}</div>
  },
}))

vi.mock('../components/curl-panel', () => ({
  __esModule: true,
  default: (props: { nodeId: string, onHide: () => void, handleCurlImport: (node: HttpNodeType) => void }) => {
    mockCurlPanel(props)
    return <div data-testid="curl-panel">{props.nodeId}</div>
  },
}))

vi.mock('../components/api-input', () => ({
  __esModule: true,
  default: (props: ApiInputProps) => {
    mockApiInput(props)
    return (
      <div>
        <div>{`${props.method}:${props.url}`}</div>
        <button type="button" onClick={() => props.onMethodChange(Method.post)}>emit-method-change</button>
        <button type="button" onClick={() => props.onUrlChange('https://changed.example.com')}>emit-url-change</button>
      </div>
    )
  },
}))

vi.mock('../components/key-value', () => ({
  __esModule: true,
  default: (props: KeyValueProps) => {
    mockKeyValue(props)
    return (
      <div>
        <div>{props.list.map(item => `${item.key}:${item.value}`).join(',')}</div>
        <button type="button" onClick={() => props.onChange([{ key: 'x-token', value: '123' }])}>
          emit-key-value-change
        </button>
        <button type="button" onClick={props.onAdd}>emit-key-value-add</button>
      </div>
    )
  },
}))

vi.mock('../components/edit-body', () => ({
  __esModule: true,
  default: (props: EditBodyProps) => {
    mockEditBody(props)
    return (
      <button
        type="button"
        onClick={() => props.onChange({
          type: BodyType.json,
          data: [{ type: BodyPayloadValueType.text, value: '{"hello":"world"}' }],
        })}
      >
        emit-body-change
      </button>
    )
  },
}))

vi.mock('../components/timeout', () => ({
  __esModule: true,
  default: (props: TimeoutProps) => {
    mockTimeout(props)
    return (
      <button type="button" onClick={() => props.onChange({ ...props.payload, connect: 9 })}>
        emit-timeout-change
      </button>
    )
  },
}))

vi.mock('@/app/components/workflow/nodes/_base/components/output-vars', () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  VarItem: ({ name, type }: { name: string, type: string }) => <div>{`${name}:${type}`}</div>,
}))

const createData = (overrides: Partial<HttpNodeType> = {}): HttpNodeType => ({
  title: 'HTTP Request',
  desc: '',
  type: BlockEnum.HttpRequest,
  variables: [],
  method: Method.get,
  url: 'https://api.example.com',
  authorization: { type: AuthorizationType.none },
  headers: '',
  params: '',
  body: { type: BodyType.none, data: [] },
  timeout: { connect: 5, read: 10, write: 15 },
  ssl_verify: true,
  ...overrides,
})

const panelProps = {} as NodePanelProps<HttpNodeType>['panelProps']

describe('http/panel', () => {
  const handleMethodChange = vi.fn()
  const handleUrlChange = vi.fn()
  const setHeaders = vi.fn()
  const addHeader = vi.fn()
  const setParams = vi.fn()
  const addParam = vi.fn()
  const setBody = vi.fn()
  const showAuthorization = vi.fn()
  const hideAuthorization = vi.fn()
  const setAuthorization = vi.fn()
  const setTimeout = vi.fn()
  const showCurlPanel = vi.fn()
  const hideCurlPanel = vi.fn()
  const handleCurlImport = vi.fn()
  const handleSSLVerifyChange = vi.fn()

  const createConfigResult = (overrides: Record<string, unknown> = {}) => ({
    readOnly: false,
    isDataReady: true,
    inputs: createData({
      authorization: { type: AuthorizationType.apiKey, config: null },
    }),
    handleMethodChange,
    handleUrlChange,
    headers: [{ key: 'accept', value: 'application/json' }],
    setHeaders,
    addHeader,
    params: [{ key: 'page', value: '1' }],
    setParams,
    addParam,
    setBody,
    isShowAuthorization: false,
    showAuthorization,
    hideAuthorization,
    setAuthorization,
    setTimeout,
    isShowCurlPanel: false,
    showCurlPanel,
    hideCurlPanel,
    handleCurlImport,
    handleSSLVerifyChange,
    ...overrides,
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockUseConfig.mockReturnValue(createConfigResult())
  })

  it('renders request fields, forwards child changes, and wires header operations', async () => {
    const user = userEvent.setup()

    render(
      <Panel
        id="http-node"
        data={createData()}
        panelProps={panelProps}
      />,
    )

    expect(screen.getByText('get:https://api.example.com')).toBeInTheDocument()
    expect(screen.getByText('body:string')).toBeInTheDocument()
    expect(screen.getByText('status_code:number')).toBeInTheDocument()
    expect(screen.getByText('headers:object')).toBeInTheDocument()
    expect(screen.getByText('files:Array[File]')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'emit-method-change' }))
    await user.click(screen.getByRole('button', { name: 'emit-url-change' }))
    await user.click(screen.getAllByRole('button', { name: 'emit-key-value-change' })[0]!)
    await user.click(screen.getAllByRole('button', { name: 'emit-key-value-add' })[0]!)
    await user.click(screen.getAllByRole('button', { name: 'emit-key-value-change' })[1]!)
    await user.click(screen.getAllByRole('button', { name: 'emit-key-value-add' })[1]!)
    await user.click(screen.getByRole('button', { name: 'emit-body-change' }))
    await user.click(screen.getByRole('button', { name: 'emit-timeout-change' }))
    await user.click(screen.getByText('workflow.nodes.http.authorization.authorization'))
    await user.click(screen.getByText('workflow.nodes.http.curl.title'))
    await user.click(screen.getByRole('switch'))

    expect(handleMethodChange).toHaveBeenCalledWith(Method.post)
    expect(handleUrlChange).toHaveBeenCalledWith('https://changed.example.com')
    expect(setHeaders).toHaveBeenCalledWith([{ key: 'x-token', value: '123' }])
    expect(addHeader).toHaveBeenCalledTimes(1)
    expect(setParams).toHaveBeenCalledWith([{ key: 'x-token', value: '123' }])
    expect(addParam).toHaveBeenCalledTimes(1)
    expect(setBody).toHaveBeenCalledWith({
      type: BodyType.json,
      data: [{ type: 'text', value: '{"hello":"world"}' }],
    })
    expect(setTimeout).toHaveBeenCalledWith(expect.objectContaining({ connect: 9 }))
    expect(showAuthorization).toHaveBeenCalledTimes(1)
    expect(showCurlPanel).toHaveBeenCalledTimes(1)
    expect(handleSSLVerifyChange).toHaveBeenCalledWith(false)
    expect(mockApiInput).toHaveBeenCalledWith(expect.objectContaining({
      method: Method.get,
      url: 'https://api.example.com',
    }))
  })

  it('returns null before the config data is ready', () => {
    mockUseConfig.mockReturnValueOnce(createConfigResult({ isDataReady: false }))

    const { container } = render(
      <Panel
        id="http-node"
        data={createData()}
        panelProps={panelProps}
      />,
    )

    expect(container).toBeEmptyDOMElement()
  })

  it('renders auth and curl panels only when writable and toggled on', () => {
    mockUseConfig.mockReturnValueOnce(createConfigResult({
      isShowAuthorization: true,
      isShowCurlPanel: true,
    }))

    const { rerender } = render(
      <Panel
        id="http-node"
        data={createData()}
        panelProps={panelProps}
      />,
    )

    expect(screen.getByTestId('authorization-modal')).toHaveTextContent('http-node')
    expect(screen.getByTestId('curl-panel')).toHaveTextContent('http-node')

    mockUseConfig.mockReturnValueOnce(createConfigResult({
      readOnly: true,
      isShowAuthorization: true,
      isShowCurlPanel: true,
    }))

    rerender(
      <Panel
        id="http-node"
        data={createData()}
        panelProps={panelProps}
      />,
    )

    expect(screen.queryByTestId('authorization-modal')).not.toBeInTheDocument()
    expect(screen.queryByTestId('curl-panel')).not.toBeInTheDocument()
    expect(screen.getByRole('switch')).toHaveAttribute('aria-disabled', 'true')
  })
})
