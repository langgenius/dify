import { loadYaml } from './yaml'

describe('loadYaml', () => {
  it('should reject duplicate mapping keys', () => {
    expect(() => loadYaml('name: first\nname: second\n')).toThrow(/duplicated mapping key/)
  })

  it('should reject complex mapping keys', () => {
    expect(() => loadYaml('? [name, region]\n: deployment\n')).toThrow(
      /does not support complex keys/,
    )
  })

  it('should parse explicit YAML sets as JavaScript sets', () => {
    expect(loadYaml('features: !!set\n  workflow:\n  chat:\n')).toEqual({
      features: new Set(['workflow', 'chat']),
    })
  })
})
