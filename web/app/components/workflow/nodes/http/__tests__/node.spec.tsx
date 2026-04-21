import type { HttpNodeType } from '../types'
import { render, screen } from '@testing-library/react'
import { BlockEnum } from '@/app/components/workflow/types'
import Node from '../node'
import { AuthorizationType, BodyType, Method } from '../types'

const mockReadonlyInputWithSelectVar = vi.hoisted(() => vi.fn())

vi.mock('@/app/components/workflow/nodes/_base/components/readonly-input-with-select-var', () => ({
  __esModule: true,
  default: (props: { value: string, nodeId: string, className?: string }) => {
    mockReadonlyInputWithSelectVar(props)
    return <div data-testid="readonly-input">{props.value}</div>
  },
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

describe('http/node', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the request method and forwards the URL to the readonly input', () => {
    render(
      <Node
        id="http-node"
        data={createData({
          method: Method.post,
          url: 'https://api.example.com/users',
        })}
      />,
    )

    expect(screen.getByText('post')).toBeInTheDocument()
    expect(screen.getByTestId('readonly-input')).toHaveTextContent('https://api.example.com/users')
    expect(mockReadonlyInputWithSelectVar).toHaveBeenCalledWith(expect.objectContaining({
      nodeId: 'http-node',
      value: 'https://api.example.com/users',
    }))
  })

  it('renders nothing when the request URL is empty', () => {
    const { container } = render(
      <Node
        id="http-node"
        data={createData({ url: '' })}
      />,
    )

    expect(container).toBeEmptyDOMElement()
  })
})
