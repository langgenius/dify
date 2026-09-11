import { describe, expect, it } from 'vite-plus/test'
import { zGetAppsByAppIdExportResponse } from './generated/api/console/apps/zod.gen'
import { zPostFilesUploadBody } from './generated/api/console/files/zod.gen'
import { zPostWorkspacesCurrentPluginUploadPkgBody } from './generated/api/console/workspaces/zod.gen'

describe('generated binary schemas', () => {
  it('accepts both Agent archives and YAML JSON export responses', () => {
    const archive = new File(['PK'], 'agent.ifpkg', { type: 'application/zip' })
    expect(zGetAppsByAppIdExportResponse.safeParse(archive).success).toBe(true)
    expect(zGetAppsByAppIdExportResponse.safeParse({ data: 'kind: app' }).success).toBe(true)
    expect(zGetAppsByAppIdExportResponse.safeParse('kind: app').success).toBe(false)
  })

  it.each([
    ['file upload', zPostFilesUploadBody, 'file'],
    ['plugin package upload', zPostWorkspacesCurrentPluginUploadPkgBody, 'pkg'],
  ] as const)('validates %s values at runtime', (_, schema, field) => {
    const file = new File(['test'], 'test.txt', { type: 'text/plain' })

    expect(schema.safeParse({ [field]: file }).success).toBe(true)
    expect(schema.safeParse({ [field]: 123 }).success).toBe(false)
  })
})
