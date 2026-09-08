import { renderHook } from '@testing-library/react'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { AgentPermission, getAgentACLCapabilities } from '../acl'
import { useCanCreateAgents, useCanImportAgents } from '../permissions'

describe('Agent creation and DSL import permissions', () => {
  it('does not let legacy manage or preview grant creation', () => {
    const { wrapper } = createConsoleQueryWrapper({
      workspacePermissionKeys: ['agent.manage', AgentPermission.Preview],
    })
    const { result } = renderHook(() => useCanCreateAgents(), { wrapper })
    expect(result.current).toBe(false)
  })

  it.each([true, false])(
    'uses default Agent ACL for import independently of create: %s',
    (canImport) => {
      const { wrapper, queryClient } = createConsoleQueryWrapper({
        workspacePermissionKeys: [AgentPermission.Create],
      })
      const key = consoleQuery.workspaces.current.rbac.myPermissions.get.queryKey()
      queryClient.setQueryData(key, {
        ...queryClient.getQueryData(key),
        agent: {
          default_permission_keys: canImport ? [AgentPermission.ImportExportDSL] : [],
          overrides: [],
        },
      })
      const { result } = renderHook(
        () => ({ canCreate: useCanCreateAgents(), canImport: useCanImportAgents() }),
        { wrapper },
      )
      expect(result.current).toEqual({ canCreate: true, canImport })
    },
  )

  it('requires both edit and run for Build mode', () => {
    expect(getAgentACLCapabilities([AgentPermission.Edit]).canBuild).toBe(false)
    expect(getAgentACLCapabilities([AgentPermission.TestAndRun]).canBuild).toBe(false)
    expect(
      getAgentACLCapabilities([AgentPermission.Edit, AgentPermission.TestAndRun]).canBuild,
    ).toBe(true)
  })
})
