import type { NameHandler } from '../../../printers/format-name.js'
import type { TableColumn, TableHandler, TableRow } from '../../../printers/format-table.js'
import type { WorkspaceListResponse } from '../../../types/data-contracts.js'
import { isPayloadShape } from '../app/payload-shape.js'

export const WORKSPACE_MODE_KEY = 'workspace'
const CURRENT_MARKER = '*'

export type WorkspaceObject = {
  mode: () => string
  raw: () => WorkspaceListResponse
}

export function newWorkspaceObject(env: WorkspaceListResponse): WorkspaceObject {
  return {
    mode: () => WORKSPACE_MODE_KEY,
    raw: () => env,
  }
}

const WORKSPACE_COLUMNS: readonly TableColumn[] = [
  { name: 'ID', priority: 0 },
  { name: 'NAME', priority: 0 },
  { name: 'ROLE', priority: 0 },
  { name: 'STATUS', priority: 0 },
  { name: 'CURRENT', priority: 0 },
]

export function workspaceTableHandler(currentId: string): TableHandler {
  return {
    columns: () => WORKSPACE_COLUMNS,
    rows: (raw): readonly TableRow[] => {
      if (!isPayloadShape<WorkspaceListResponse>(raw, 'workspaces'))
        throw new Error('get/workspace table: unexpected payload shape')
      return raw.workspaces.map(w => [
        w.id,
        w.name,
        w.role,
        w.status,
        w.current || (currentId !== '' && w.id === currentId) ? CURRENT_MARKER : '',
      ])
    },
  }
}

export const workspaceNameHandler: NameHandler = {
  id(raw: unknown): string {
    if (!isPayloadShape<WorkspaceListResponse>(raw, 'workspaces'))
      throw new Error('get/workspace name: unexpected payload shape')
    return raw.workspaces.map(w => w.id).join('\n')
  },
}
