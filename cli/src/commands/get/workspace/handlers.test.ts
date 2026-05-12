import type { WorkspaceListResponseType } from '../../../types/openapi-schemas.js'
import { describe, expect, it } from 'vitest'
import { newWorkspaceObject, WORKSPACE_MODE_KEY, workspaceNameHandler, workspaceTableHandler } from './handlers.js'

function env(): WorkspaceListResponseType {
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
    const e: WorkspaceListResponseType = {
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
})
