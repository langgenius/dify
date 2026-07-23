import { describe, expect, it } from 'vitest'
import { zPostFilesUploadBody } from './generated/api/console/files/zod.gen'
import { zPostWorkspacesCurrentPluginUploadPkgBody } from './generated/api/console/workspaces/zod.gen'

describe('generated binary schemas', () => {
  it.each([
    ['file upload', zPostFilesUploadBody, 'file'],
    ['plugin package upload', zPostWorkspacesCurrentPluginUploadPkgBody, 'pkg'],
  ] as const)('validates %s values at runtime', (_, schema, field) => {
    const file = new File(['test'], 'test.txt', { type: 'text/plain' })

    expect(schema.safeParse({ [field]: file }).success).toBe(true)
    expect(schema.safeParse({ [field]: 123 }).success).toBe(false)
  })
})
