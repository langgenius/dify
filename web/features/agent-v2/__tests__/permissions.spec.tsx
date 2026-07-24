import { render, screen } from '@testing-library/react'
import { Suspense } from 'react'
import { consoleQuery } from '@/service/client'
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

  it('suspends instead of treating a pending snapshot as empty permissions', () => {
    const { queryClient, wrapper } = createConsoleQueryWrapper({ workspacePermissionKeys: null })
    void queryClient.prefetchQuery({
      queryKey: consoleQuery.workspaces.current.rbac.myPermissions.get.queryOptions().queryKey,
      queryFn: () => new Promise(() => {}),
    })

    render(
      <Suspense fallback={<span>permission loading</span>}>
        <PermissionProbe />
      </Suspense>,
      { wrapper },
    )

    expect(screen.getByText('permission loading')).toBeInTheDocument()
    expect(screen.queryByText('false')).not.toBeInTheDocument()
  })
})
