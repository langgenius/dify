import { render, screen } from '@testing-library/react'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { useCanManageAgents } from '../permissions'

function PermissionProbe() {
  return <span>{String(useCanManageAgents())}</span>
}

describe('useCanManageAgents', () => {
  it.each([
    [['agent.manage'], 'true'],
    [['dataset.create_and_management'], 'false'],
  ])('resolves agent.manage from the current permission snapshot', (permissionKeys, expected) => {
    const { wrapper } = createConsoleQueryWrapper({ workspacePermissionKeys: permissionKeys })

    render(<PermissionProbe />, { wrapper })

    expect(screen.getByText(expected)).toBeInTheDocument()
  })
})
