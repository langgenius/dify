import type { WorkspaceListResponse } from '@dify/contracts/api/openapi/types.gen'
import { describe, expect, it } from 'vite-plus/test'
import { WorkspaceListOutput, WorkspaceRow } from './handlers'

function env(): WorkspaceListResponse {
  return {
    workspaces: [
      {
        id: 'ws-1',
        name: 'Default',
        roles: [{ id: 'owner', name: 'Owner' }],
        status: 'normal',
        current: true,
      },
      {
        id: '00000000-0000-0000-0000-000000000002',
        name: 'Other',
        roles: [{ id: 'normal', name: 'Member' }],
        status: 'normal',
        current: false,
      },
    ],
  }
}

describe('get/workspace handlers', () => {
  it('WorkspaceRow defines table, name, and json print shapes', () => {
    const roles = [
      { id: 'owner', name: 'Owner' },
      { id: 'auditor', name: '' },
    ]
    const row = new WorkspaceRow('ws-1', 'Default', roles, 'normal', true)
    expect(row.tableRow()).toEqual(['ws-1', 'Default', 'Owner, auditor', 'normal', '*'])
    expect(row.name()).toBe('ws-1')
    expect(row.json()).toEqual({
      id: 'ws-1',
      name: 'Default',
      roles,
      status: 'normal',
      current: true,
    })
  })

  it('WorkspaceListOutput defines cohesive print behavior', () => {
    const row = new WorkspaceRow(
      'ws-1',
      'Default',
      [{ id: 'owner', name: 'Owner' }],
      'normal',
      true,
    )
    const output = new WorkspaceListOutput([row], env())
    expect(output.tableColumns().map((column) => column.name)).toEqual([
      'ID',
      'NAME',
      'ROLES',
      'STATUS',
      'CURRENT',
    ])
    expect(output.tableRows()).toEqual([['ws-1', 'Default', 'Owner', 'normal', '*']])
    expect(output.name()).toBe('ws-1')
    expect(output.json().workspaces).toHaveLength(2)
  })
})
