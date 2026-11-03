import {
  existsSync,
  globSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vite-plus/test'
import { normalizeApiSwagger } from './api-documents.ts'
import {
  renderCompatibilityTypes,
  selectCommunityDocument,
} from './scripts/export-compatibility-types.ts'
import { generateCompatibilitySources } from './scripts/generate-compatibility-sources.ts'

const root = import.meta.dirname

describe('compatible contracts exports', () => {
  it('keeps exact backend origins on renamed models and every operation envelope', async () => {
    const file = resolve(root, 'backend (models)*/models.py')
    const source = { file, line: 17 }
    const document = normalizeApiSwagger({
      openapi: '3.1.0',
      info: { title: 'Navigation', version: '1' },
      paths: {
        '/pets': {
          post: {
            'x-source-location': { file, line: 42 },
            requestBody: {
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/pet-model' } },
              },
            },
            responses: {
              200: {
                content: {
                  'application/json': { schema: { $ref: '#/components/schemas/pet-model' } },
                },
              },
              400: { content: { 'application/json': { schema: { type: 'string' } } } },
            },
          },
        },
      },
      components: {
        schemas: {
          'pet-model': { type: 'object', 'x-source-location': source },
          Missing: { type: 'string' },
          Relative: { type: 'string', 'x-source-location': { file: 'models.py', line: 1 } },
          Invalid: { type: 'string', 'x-source-location': { file, line: 0 } },
        },
      },
    })
    const output = await renderCompatibilityTypes(document)
    const href = pathToFileURL(file)
      .href.replaceAll('*', '%2A')
      .replaceAll('(', '%28')
      .replaceAll(')', '%29')
    expect(output).toContain(
      `/** [Open backend implementation](${href}#L17) */\nexport type PetModel`,
    )
    for (const suffix of ['Data', 'Responses', 'Response', 'Errors', 'Error'])
      expect(output).toContain(
        `/** [Open backend implementation](${href}#L42) */\nexport type PostPets${suffix} =`,
      )
    expect(output.match(/Open backend implementation/g)).toHaveLength(6)
  })

  it('generates subpath entries, preserves no-op mtimes and removes obsolete generated files', async () => {
    const directory = mkdtempSync(resolve(tmpdir(), 'dify-contracts-descriptors-'))
    try {
      const generated = resolve(directory, 'generated/api/console/new-feature')
      const descriptor = resolve(directory, 'mapper/console/new-feature.openapi-types')
      const declaration = resolve(directory, 'mapper/console/new-feature.d.ts')
      mkdirSync(generated, { recursive: true })
      writeFileSync(resolve(generated, 'types.gen.ts'), 'export type NewFeature = string')
      await generateCompatibilitySources(directory, resolve(directory, 'mapper'))
      expect(JSON.parse(readFileSync(descriptor, 'utf8')).args[0]).toBe('api/console/new-feature')
      expect(readFileSync(declaration, 'utf8')).toContain(
        "export type * from './new-feature.openapi-types'",
      )
      const files = [
        descriptor,
        resolve(directory, 'mapper/community.source.json'),
        resolve(directory, 'mapper/enterprise.source.json'),
        declaration,
      ]
      const timestamps = files.map((file) => statSync(file).mtimeMs)
      expect(readFileSync(files[1]!, 'utf8')).toContain(
        '"command": ["node", "packages/contracts/scripts/export-compatibility-types.ts"]',
      )
      await generateCompatibilitySources(directory, resolve(directory, 'mapper'))
      expect(files.map((file) => statSync(file).mtimeMs)).toEqual(timestamps)
      rmSync(resolve(generated, 'types.gen.ts'))
      await generateCompatibilitySources(directory, resolve(directory, 'mapper'))
      expect(existsSync(descriptor)).toBe(false)
      expect(existsSync(declaration)).toBe(false)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
  it('exposes all generated types through mapper subpaths with shared descriptors', () => {
    const mapper = resolve(root, '../openapi-content-mapper')
    const pkg = JSON.parse(readFileSync(resolve(mapper, 'package.json'), 'utf8'))
    const legacy = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
    expect(Object.keys(legacy.exports)).toEqual([
      './marketplace',
      './console',
      './api/*',
      './enterprise/*',
      './enterprise-app-deploy/*',
    ])
    const modules = globSync('generated/**/types.gen.ts', { cwd: root })
    expect(modules.length).toBeGreaterThan(50)
    for (const file of modules) {
      const module = file.slice('generated/'.length, -'/types.gen.ts'.length)
      const subpath = module.replace(/^api\//, '')
      const key = subpath.startsWith('console/') ? './console/*' : `./${subpath}`
      const entry = pkg.exports[key]
      expect(Object.keys(entry)).toEqual(['types'])
      const declarationPath = resolve(
        mapper,
        entry.types.replace('*', subpath.slice('console/'.length)),
      )
      expect(declarationPath).toMatch(/\.d\.ts$/)
      const descriptorPath = declarationPath.replace(/\.d\.ts$/, '.openapi-types')
      expect(readFileSync(declarationPath, 'utf8')).toContain(
        `export type * from './${subpath.split('/').at(-1)}.openapi-types'`,
      )
      const descriptor = JSON.parse(readFileSync(descriptorPath, 'utf8'))
      expect(Object.keys(descriptor)).toEqual(['extends', 'args'])
      expect(descriptor.args).toEqual([module])
      const base = JSON.parse(
        readFileSync(resolve(descriptorPath, '..', descriptor.extends), 'utf8'),
      )
      expect(base.command).toEqual([
        'node',
        'packages/contracts/scripts/export-compatibility-types.ts',
      ])
      // Repository-specific exports must not leak broken paths into the public SDK tarball.
      expect(pkg.publishConfig.exports[key]).toBeUndefined()
    }
  })

  it('automatically exports new models, legacy envelopes, status maps, unions and recursive schemas', async () => {
    const reference = { $ref: '#/components/schemas/Tree' }
    const document = normalizeApiSwagger({
      openapi: '3.1.0',
      info: { title: 'Compatibility', version: '1' },
      paths: {
        '/trees/{id}': {
          parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string' } }],
          post: {
            requestBody: { required: true, content: { 'application/json': { schema: reference } } },
            responses: {
              201: { content: { 'application/json': { schema: reference } } },
              204: { description: 'Empty' },
              409: {
                content: { 'application/json': { schema: { type: 'string', const: 'conflict' } } },
              },
              default: { content: { 'application/json': { schema: { type: 'string' } } } },
            },
          },
        },
      },
      components: {
        schemas: {
          Tree: {
            type: 'object',
            required: ['children'],
            properties: { children: { type: 'array', items: reference } },
          },
        },
      },
    })
    const output = await renderCompatibilityTypes(document)
    for (const name of [
      'ClientOptions',
      'Tree',
      'PostTreesByIdData',
      'PostTreesByIdResponses',
      'PostTreesByIdResponse',
      'PostTreesByIdErrors',
      'PostTreesByIdError',
    ])
      expect(output).toContain(`export type ${name} =`)
    expect(output).toMatch(/path: \{\s*id: string;/)
    expect(output).toContain("url: '/trees/{id}'")
    expect(output).toContain('201: Tree')
    expect(output).toContain('204: void')
    expect(output).toContain("409: 'conflict'")
    expect(output).toContain('default: string')
    expect(output).toContain('children: Array<Tree>')
    expect(existsSync(resolve(root, '.compatibility-output'))).toBe(false)
  })

  it('shares Console normalization, FastOpenAPI merge and module splitting with code generation', () => {
    const documents = {
      'console-openapi.json': {
        openapi: '3.1.0',
        paths: { '/pets': { get: { responses: { 200: { description: 'Opaque' } } } } },
      },
      'fastopenapi-console-openapi.json': {
        openapi: '3.1.0',
        paths: {
          '/console/api/knowledge-fs/health': {
            get: { responses: { 204: { description: 'Healthy' } } },
          },
        },
      },
    }
    const pets = selectCommunityDocument('api/console/pets', documents)
    expect(Object.keys(pets.paths!)).toEqual(['/pets'])
    expect(pets.paths!['/pets']!.get).toMatchObject({
      operationId: 'getPets',
      responses: {
        200: {
          content: {
            'application/json': { schema: { type: 'object', additionalProperties: true } },
          },
        },
      },
    })
    const health = selectCommunityDocument('api/console/knowledge-fs', documents)
    expect(Object.keys(health.paths!)).toEqual(['/knowledge-fs/health'])
    expect(documents['console-openapi.json'].paths['/pets'].get).not.toHaveProperty('operationId')
    expect(() => selectCommunityDocument('api/console/missing', documents)).toThrow(
      'No Console operations',
    )
  })
})
