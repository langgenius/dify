import type { ComponentProps } from 'react'
import type { Tool } from '@/app/components/tools/types'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createMcpProviderFixture } from '@/test/fixtures/mcp'
import MCPCard from '../provider-card'

const tool: Tool = {
  name: 'search',
  author: 'Dify',
  label: { en_US: 'Search', zh_Hans: 'Search' },
  description: { en_US: 'Search documents', zh_Hans: 'Search documents' },
  parameters: [],
  labels: [],
  output_schema: {},
}
const setup = (props: Partial<ComponentProps<typeof MCPCard>> = {}, canManage = true) => {
  const handleSelect = vi.fn()
  const onEdit = vi.fn()
  const onDelete = vi.fn()
  const { wrapper } = createConsoleQueryWrapper({
    workspacePermissionKeys: canManage ? ['mcp.manage'] : [],
  })
  render(
    <MCPCard
      data={createMcpProviderFixture({ tools: [tool] })}
      handleSelect={handleSelect}
      onEdit={onEdit}
      onDelete={onDelete}
      {...props}
    />,
    { wrapper },
  )
  return { handleSelect, onEdit, onDelete, user: userEvent.setup() }
}

describe('MCP provider card', () => {
  it.each([
    { authorized: true, tools: [tool], configured: true },
    { authorized: false, tools: [tool], configured: false },
    { authorized: true, tools: [], configured: false },
  ])(
    'requires both authorization and tools for configured status ($authorized, $configured)',
    ({ authorized, tools, configured }) => {
      setup({ data: createMcpProviderFixture({ is_team_authorization: authorized, tools }) })
      expect(
        screen.getByRole('button', {
          name: configured ? /tools\.mcp\.configured/ : /tools\.mcp\.noConfigured/,
        }),
      ).toBeInTheDocument()
      if (!tools.length) expect(screen.getByText('tools.mcp.noTools')).toBeInTheDocument()
    },
  )

  it('selects the provider when its card is clicked', async () => {
    const { user, handleSelect } = setup()
    await user.click(screen.getByRole('button', { name: /Existing Server/ }))
    expect(handleSelect).toHaveBeenCalledWith('mcp-1')
  })

  it('hides management actions without mcp.manage permission', () => {
    setup({}, false)
    expect(screen.queryByRole('button', { name: 'common.operation.more' })).not.toBeInTheDocument()
  })

  it.each(['edit', 'remove'] as const)('requests %s without selecting the card', async (action) => {
    const { user, handleSelect, onEdit, onDelete } = setup()
    await user.click(screen.getByRole('button', { name: 'common.operation.more' }))
    await user.click(screen.getByRole('menuitem', { name: `tools.mcp.operation.${action}` }))
    expect(action === 'edit' ? onEdit : onDelete).toHaveBeenCalledWith('mcp-1')
    expect(handleSelect).not.toHaveBeenCalled()
  })
})
