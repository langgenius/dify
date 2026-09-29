import { renderHook } from '@testing-library/react'
import { consoleQuery } from '@/service/console'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { AgentPermission, getAgentACLCapabilities } from '../acl'
import { useCanCreateAgents, useCanImportAgents } from '../permissions'

describe('Agent creation and package import permissions', () => {
  it('does not let legacy manage or preview grant creation', () => {
    const { wrapper } = createConsoleQueryWrapper({
      workspacePermissionKeys: ['agent.manage', AgentPermission.Preview],
    })
    const { result } = renderHook(() => useCanCreateAgents(), { wrapper })
    expect(result.current).toBe(false)
  })

  it.each([
    { canCreate: true, hasImportPermission: true },
    { canCreate: true, hasImportPermission: false },
    { canCreate: false, hasImportPermission: true },
    { canCreate: false, hasImportPermission: false },
  ])(
    'requires creation and default Agent import permissions: %o',
    ({ canCreate, hasImportPermission }) => {
      const { wrapper, queryClient } = createConsoleQueryWrapper({
        workspacePermissionKeys: canCreate ? [AgentPermission.Create] : [],
      })
      const key = consoleQuery.workspaces.current.rbac.myPermissions.get.queryKey()
      queryClient.setQueryData(key, {
        ...queryClient.getQueryData(key),
        agent: {
          default_permission_keys: hasImportPermission ? [AgentPermission.ImportExportDSL] : [],
          overrides: [],
        },
      })
      const { result } = renderHook(
        () => ({ canCreate: useCanCreateAgents(), canImport: useCanImportAgents() }),
        { wrapper },
      )
      expect(result.current).toEqual({ canCreate, canImport: canCreate && hasImportPermission })
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
