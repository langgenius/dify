import type { WorkspaceListResponse } from '../../../types/data-contracts.js'
import { describe, expect, it } from 'vitest'
import { newWorkspaceObject, WORKSPACE_MODE_KEY, WorkspaceListOutput, workspaceNameHandler, WorkspaceRow, workspaceTableHandler } from './handlers.js'

function env(): WorkspaceListResponse {
  return {
    workspaces: [
      { id: 'ws-1', name: 'Default', role: 'owner', status: 'normal', current: true },
      { id: 'ws-2', name: 'Other', role: 'normal', status: 'normal', current: false },
    ],
  }
}

describe('get/workspace handlers', () => {
  it('newWorkspaceObject mode = workspace + raw passthrough', () => {
    const obj = newWorkspaceObject(env())
    expect(obj.mode()).toBe(WORKSPACE_MODE_KEY)
    expect(obj.raw().workspaces[0]?.id).toBe('ws-1')
  })

  it('workspaceTableHandler marks current via server flag', () => {
    const rows = workspaceTableHandler('').rows(env())
    expect(rows[0]?.at(-1)).toBe('*')
    expect(rows[1]?.at(-1)).toBe('')
  })

  it('workspaceTableHandler marks current via currentId fallback', () => {
    const e: WorkspaceListResponse = {
      workspaces: [
        { id: 'ws-1', name: 'Default', role: 'owner', status: 'normal', current: false },
        { id: 'ws-2', name: 'Other', role: 'normal', status: 'normal', current: false },
      ],
    }
    const rows = workspaceTableHandler('ws-2').rows(e)
    expect(rows[0]?.at(-1)).toBe('')
    expect(rows[1]?.at(-1)).toBe('*')
  })

  it('workspaceTableHandler emits ID NAME ROLE STATUS CURRENT row order', () => {
    const rows = workspaceTableHandler('').rows(env())
    expect(rows[0]).toEqual(['ws-1', 'Default', 'owner', 'normal', '*'])
  })

  it('workspaceNameHandler returns ids joined by newline', () => {
    expect(workspaceNameHandler.id(env())).toBe('ws-1\nws-2')
  })

  it('WorkspaceRow defines table, name, and json print shapes', () => {
    const row = new WorkspaceRow('ws-1', 'Default', 'owner', 'normal', true)
    expect(row.tableRow()).toEqual(['ws-1', 'Default', 'owner', 'normal', '*'])
    expect(row.name()).toBe('ws-1')
    expect(row.json()).toEqual({ id: 'ws-1', name: 'Default', role: 'owner', status: 'normal', current: true })
  })

  it('WorkspaceListOutput defines cohesive print behavior', () => {
    const row = new WorkspaceRow('ws-1', 'Default', 'owner', 'normal', true)
    const output = new WorkspaceListOutput([row], env())
    expect(output.tableColumns().map(column => column.name)).toEqual(['ID', 'NAME', 'ROLE', 'STATUS', 'CURRENT'])
    expect(output.tableRows()).toEqual([['ws-1', 'Default', 'owner', 'normal', '*']])
    expect(output.name()).toBe('ws-1')
    expect(output.json().workspaces).toHaveLength(2)
  })
})
