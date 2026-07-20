import type { WorkspaceListResponse } from '@dify/contracts/api/openapi/types.gen'
import { describe, expect, it } from 'vitest'
import { WorkspaceListOutput, WorkspaceRow } from './handlers'

function env(): WorkspaceListResponse {
  return {
    workspaces: [
      { id: 'ws-1', name: 'Default', role: 'owner', status: 'normal', current: true },
      {
        id: '00000000-0000-0000-0000-000000000002',
        name: 'Other',
        role: 'normal',
        status: 'normal',
        current: false,
      },
    ],
  }
}

describe('get/workspace handlers', () => {
  it('WorkspaceRow defines table, name, and json print shapes', () => {
    const row = new WorkspaceRow('ws-1', 'Default', 'owner', 'normal', true)
    expect(row.tableRow()).toEqual(['ws-1', 'Default', 'owner', 'normal', '*'])
    expect(row.name()).toBe('ws-1')
    expect(row.json()).toEqual({
      id: 'ws-1',
      name: 'Default',
      role: 'owner',
      status: 'normal',
      current: true,
    })
  })

  it('WorkspaceListOutput defines cohesive print behavior', () => {
    const row = new WorkspaceRow('ws-1', 'Default', 'owner', 'normal', true)
    const output = new WorkspaceListOutput([row], env())
    expect(output.tableColumns().map((column) => column.name)).toEqual([
      'ID',
      'NAME',
      'ROLE',
      'STATUS',
      'CURRENT',
    ])
    expect(output.tableRows()).toEqual([['ws-1', 'Default', 'owner', 'normal', '*']])
    expect(output.name()).toBe('ws-1')
    expect(output.json().workspaces).toHaveLength(2)
  })
})
