import { render, screen } from '@testing-library/react'
import { IntegrationsRoutePage } from '../route-page'

let mockPathname = '/integrations/model-provider'

vi.mock('@/next/navigation', () => ({
  usePathname: () => mockPathname,
}))
vi.mock('../index', () => ({
  default: ({ section }: { section: string }) => <p>{`section: ${section}`}</p>,
}))

describe('IntegrationsRoutePage', () => {
  it('renders the section of the current integrations path', () => {
    mockPathname = '/integrations/tools/mcp'
    render(<IntegrationsRoutePage />)

    expect(screen.getByText('section: mcp')).toBeInTheDocument()
  })

  it('renders nothing for a path the route segment redirects', () => {
    mockPathname = '/integrations/tools'
    const { container } = render(<IntegrationsRoutePage />)

    expect(container).toBeEmptyDOMElement()
  })
})
