import { describe, expect, it } from 'vite-plus/test'
import { workspaces } from './generated/api/console/workspaces/orpc.gen.ts'
import { addErrorContracts, errorContractsFor } from './scripts/generate-error-contracts.mjs'

describe('declared API errors', () => {
  it('generates the Skill save contract from the documented response models', () => {
    const errors = workspaces.current.skills.bySkillId.files.patch['~orpc'].errorMap
    expect(Object.keys(errors).sort()).toEqual(['skill_conflict', 'skill_not_found'])
    expect(errors.skill_conflict.status).toBe(409)
    expect(errors.skill_not_found.status).toBe(404)
    expect(
      errors.skill_conflict.data.safeParse({
        code: 'skill_conflict',
        message: 'Changed',
        details: { current_updated_at: 2, expected_updated_at: 1 },
      }).success,
    ).toBe(true)
    expect(
      errors.skill_conflict.data.safeParse({
        code: 'skill_conflict',
        message: 'Changed',
        details: { current_updated_at: '2' },
      }).success,
    ).toBe(false)
  })

  it('does not declare errors for an existing endpoint implicitly', () => {
    const operation = {
      operationId: 'save',
      responses: {
        default: {
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Conflict' } } },
        },
        409: {
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Conflict' } } },
        },
      },
    }
    const document = {
      paths: { '/draft': { patch: operation } },
      components: { schemas: { Conflict: { properties: { code: { const: 'conflict' } } } } },
    }
    expect(errorContractsFor(document)).toEqual({})
    expect(
      errorContractsFor({
        ...document,
        paths: { '/draft': { patch: { ...operation, 'x-dify-typed-errors': true } } },
      }),
    ).toEqual({
      save: { conflict: { status: 409, schema: 'zConflict' } },
    })
  })

  it('fails generation if a declared operation cannot be found instead of silently dropping its errors', () => {
    expect(() =>
      addErrorContracts('// generated\nexport const router = {}', {
        save: { conflict: { status: 409, schema: 'zConflict' } },
      }),
    ).toThrow('save')
    const output = addErrorContracts(
      '// generated\nexport const save = oc.route({operationId: "save"}).output(zResult)',
      {
        save: { conflict: { status: 409, schema: 'zConflict' } },
      },
    )
    expect(output).toContain('.errors({"conflict": { status: 409, data: errorSchemas.zConflict }})')
    expect(output).toMatch(/^\/\/ generated\n\nimport/)
  })
})
