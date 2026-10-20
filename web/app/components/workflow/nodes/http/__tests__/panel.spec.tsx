import type { HttpNodeType } from '../types'
import type { NodePanelProps } from '@/app/components/workflow/types'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWorkflowFlowComponent as render } from '@/app/components/workflow/__tests__/workflow-test-env'
import { BlockEnum } from '@/app/components/workflow/types'
import Panel from '../panel'
import { AuthorizationType, BodyType, Method } from '../types'

const mockUseConfig = vi.hoisted(() => vi.fn())

vi.mock('../use-config', () => ({ default: (...args: unknown[]) => mockUseConfig(...args) }))
vi.mock('@/app/components/workflow/nodes/_base/hooks/use-available-var-list', () => ({
  default: () => ({ availableVars: [], availableNodesWithParent: [], availableNodes: [] }),
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
  const setAuthorization = vi.fn()
  const setTimeout = vi.fn()
  const handleCurlImport = vi.fn()

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
    setAuthorization,
    setTimeout,
    handleCurlImport,
    handleSSLVerifyChange: vi.fn(),
    ...overrides,
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockUseConfig.mockReturnValue(createConfigResult())
  })

  it('commits the selected method, body format and timeout from real controls', async () => {
    const user = userEvent.setup()
    render(<Panel id="http-node" data={createData()} panelProps={panelProps} />)
    await user.click(screen.getByText('get'))
    await user.click(screen.getByText('POST'))
    expect(handleMethodChange).toHaveBeenCalledExactlyOnceWith(Method.post)
    await user.click(screen.getByRole('radio', { name: 'JSON' }))
    expect(setBody).toHaveBeenCalledExactlyOnceWith({ type: BodyType.json, data: [] })
    await user.click(
      screen.getByRole('button', { name: 'workflowIntegrations.nodes.http.timeout.title' }),
    )
    const connect = screen.getByRole('textbox', {
      name: 'workflowIntegrations.nodes.http.timeout.connectLabel',
    })
    await user.clear(connect)
    await user.type(connect, '9')
    expect(setTimeout).toHaveBeenLastCalledWith({ connect: 9, read: 10, write: 15 })
    await user.click(
      screen.getByRole('button', { name: 'workflowIntegrations.nodes.http.curl.title' }),
    )
    expect(
      screen.getByRole('dialog', { name: 'workflowIntegrations.nodes.http.curl.title' }),
    ).toBeInTheDocument()
  })

  it('keeps request controls unavailable until config data is ready', () => {
    mockUseConfig.mockReturnValue(createConfigResult({ isDataReady: false }))
    render(<Panel id="http-node" data={createData()} panelProps={panelProps} />)
    expect(screen.queryByRole('radio', { name: 'JSON' })).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'workflowIntegrations.nodes.http.curl.title' }),
    ).not.toBeInTheDocument()
  })

  it('blocks request changes when the panel becomes read-only', async () => {
    const user = userEvent.setup()
    const { rerender } = render(
      <Panel id="http-node" data={createData()} panelProps={panelProps} />,
    )
    expect(screen.getByRole('button', { name: /authorization.authorization/ })).toBeEnabled()
    mockUseConfig.mockReturnValue(createConfigResult({ readOnly: true }))
    rerender(<Panel id="http-node" data={createData()} panelProps={panelProps} />)
    expect(
      screen.queryByRole('button', { name: /authorization.authorization/ }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'workflowIntegrations.nodes.http.curl.title' }),
    ).not.toBeInTheDocument()
    await user.click(screen.getByText('get'))
    expect(screen.queryByText('POST')).not.toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: 'JSON' }))
    await user.click(screen.getByRole('switch'))
    await user.click(
      screen.getByRole('button', { name: 'workflowIntegrations.nodes.http.timeout.title' }),
    )
    const connect = screen.getByRole('textbox', {
      name: 'workflowIntegrations.nodes.http.timeout.connectLabel',
    })
    expect(connect).toHaveAttribute('readonly')
    await user.type(connect, '9')
    expect(handleMethodChange).not.toHaveBeenCalled()
    expect(setBody).not.toHaveBeenCalled()
    expect(setTimeout).not.toHaveBeenCalled()
  })
})
