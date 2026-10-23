/* oxlint-disable vitest/no-import-node-test -- Integration tests exercise the built package in native Node, including its module hooks. */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { parse, parseDocument } from 'yaml'
/* oxlint-enable vitest/no-import-node-test */

const root = resolve(import.meta.dirname, '..')
const compiler = join(root, 'node_modules/typescript/bin/tsc')
const yaml = readFileSync(join(root, 'examples/petstore/pets.openapi.yaml'), 'utf8')

test('document configuration types context for both the API and query namespaces', () => {
  project(
    {
      'pets.yaml': yaml,
      'pets.yaml.config.ts': `
import type { RuntimeConfig } from '@dify/openapi-inference';
export type Context = { silent?: boolean };
const runtime: RuntimeConfig = { queryKeyPrefix: ['console'] };
export default runtime;
`,
      'index.ts': `
import { api, query } from './pets.yaml';
await api.pets.get(undefined, { context: { silent: true } });
query.pets.get.queryOptions({ input: {}, context: { silent: true } });
// @ts-expect-error context is inferred from the document configuration
api.pets.get(undefined, { context: { silent: 'yes' } });
// @ts-expect-error query helpers preserve that same context
query.pets.get.queryOptions({ input: {}, context: { silent: 'yes' } });
// @ts-expect-error query helpers retain operation inputs alongside the context
query.pets.byPetId.get.queryOptions({ input: { params: { petId: 'wrong' } }, context: { silent: true } });
`,
    },
    (_dir, compile) => {
      const result = compile()
      assert.equal(result.status, 0, result.output)
    },
  )
})

function project(files, run) {
  const dir = mkdtempSync(join(root, 'test/.tmp-'))
  try {
    writeFileSync(
      join(dir, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          strict: true,
          noEmit: true,
          skipLibCheck: true,
          target: 'ES2022',
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          types: ['node'],
          lib: ['ES2022', 'DOM'],
        },
        contentMappers: [{ package: root, extensions: ['.yaml', '.yml', '.openapi'] }],
        include: ['*.ts'],
      }),
    )
    for (const [file, content] of Object.entries(files)) writeFileSync(join(dir, file), content)
    run(dir, () => {
      const result = spawnSync(
        process.execPath,
        [compiler, '-p', dir, '--runExternalCode', '--pretty', 'false'],
        { cwd: root, encoding: 'utf8', timeout: 20000 },
      )
      assert.ifError(result.error)
      return { status: result.status, output: result.stdout + result.stderr }
    })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

for (const [extension, content] of [
  ['yaml', yaml],
  ['openapi', JSON.stringify(parse(yaml))],
]) {
  test(`TS 7.1 ${extension}: accurate SDK types, rejected invalid calls, no generated files`, () => {
    project(
      {
        [`pets.${extension}`]: content,
        'index.ts': `
import * as api from './pets.${extension}';
import { createTanstackQueryUtils } from '@orpc/tanstack-query';
const nestedPet = await api.api.pets.byPetId.get({ params: { petId: 1 } });
const nestedName: string = nestedPet.name;
await api.api.pets.get();
await api.api.pets.post({ body: { name: 'Mochi' } });
const query = createTanstackQueryUtils(api.api);
const generatedOptions = api.query.pets.byPetId.get.queryOptions({ input: { params: { petId: 1 } } });
const generatedKey = api.query.pets.key();
// @ts-expect-error generated query helpers retain parameter types
api.query.pets.byPetId.get.queryOptions({ input: { params: { petId: 'wrong' } } });
const queryOptions = query.pets.byPetId.get.queryOptions({ input: { params: { petId: 1 } } });
type QueryResult = Awaited<ReturnType<typeof queryOptions.queryFn>>;
const queryName: string = (null! as QueryResult).name;
// @ts-expect-error query helpers retain required parameter types
query.pets.byPetId.get.queryOptions({ input: { params: { petId: 'wrong' } } });
// @ts-expect-error nested call requires params
api.api.pets.byPetId.get();
// @ts-expect-error nested return type is not any
const nestedWrong: number = nestedPet.name;
const pet = await api.getPet({ path: { petId: 1 } });
const name: string = pet.name;
const id: number = pet.id;
const state: 'available' | 'adopted' = pet.status;
const nickname: string | null | undefined = pet.nickname;
const pets = await api.listPets();
const item: typeof pet = pets[0]!;
const created: typeof pet = await api.createPet({ body: { name: 'Mochi' } });
const deleted: undefined = await api.deletePet({ path: { petId: 1 } });
await api.listPets({ query: { limit: 10, status: 'available' } });
type IsAny<T> = 0 extends (1 & T) ? true : false;
const notAny: IsAny<typeof pet> = false;
// @ts-expect-error response must not silently become any
const wrong: number = pet.name;
// @ts-expect-error no invented response fields
pet.missing;
// @ts-expect-error required path group
api.getPet();
// @ts-expect-error required path parameter
api.getPet({ path: {} });
// @ts-expect-error integer parameter
api.getPet({ path: { petId: '1' } });
// @ts-expect-error unknown operation
api.unknown();
// @ts-expect-error enum values retained from file
api.listPets({ query: { status: 'lost' } });
// @ts-expect-error no undeclared query arguments
api.listPets({ query: { invented: true } });
// @ts-expect-error required body
api.createPet();
// @ts-expect-error required property in body
api.createPet({ body: {} });
// @ts-expect-error no body on GET
api.listPets({ body: {} });
`,
      },
      (dir, check) => {
        const before = readdirSync(dir)
        const result = check()
        assert.equal(result.status, 0, result.output)
        assert.deepEqual(readdirSync(dir), before)
      },
    )
  })
}

test('schema changes invalidate types on the next native compilation', () => {
  project(
    {
      'pets.yaml': yaml,
      'index.ts': `
import { getPet } from './pets.yaml';
const pet = await getPet({path: {petId: 1}});
const id: number = pet.id;
`,
    },
    (dir, check) => {
      assert.equal(check().status, 0)
      const changed = parseDocument(yaml)
      changed.setIn(['components', 'schemas', 'Pet', 'properties', 'id', 'type'], 'string')
      writeFileSync(join(dir, 'pets.yaml'), changed.toString())
      const result = check()
      assert.notEqual(result.status, 0)
      assert.match(result.output, /Type 'string' is not assignable to type 'number'/)
    },
  )
})

test('invalid specs and unresolved refs are compiler diagnostics, not any', () => {
  for (const content of [
    'openapi: [',
    yaml.replace('#/components/schemas/Pet', '#/components/schemas/Missing'),
  ]) {
    project(
      { 'bad.yaml': content, 'index.ts': "import * as spec from './bad.yaml'; export { spec };" },
      (_dir, check) => {
        const result = check()
        assert.notEqual(result.status, 0)
        assert.match(result.output, /1001/)
        assert.match(result.output, /bad.yaml/)
      },
    )
  }
})

test('schema composition, nullable, parameter overrides, dictionaries and escaped references', () => {
  const spec = parse(yaml)
  spec.components.schemas['A/B~C'] = { type: 'integer' }
  spec.components.schemas.Pet = {
    allOf: [
      {
        type: 'object',
        required: ['id'],
        properties: { id: { $ref: '#/components/schemas/A~1B~0C' } },
      },
      {
        type: 'object',
        required: ['choice', 'dictionary', 'nullable'],
        properties: {
          choice: { oneOf: [{ const: 'yes' }, { type: 'integer' }] },
          dictionary: { type: 'object', additionalProperties: { type: 'number' } },
          nullable: { type: 'string', nullable: true },
        },
      },
    ],
  }
  spec.paths['/pets/{petId}'].get.parameters = [
    { name: 'petId', in: 'path', required: true, schema: { type: 'string' } },
  ]
  project(
    {
      'spec.openapi': JSON.stringify(spec),
      'index.ts': `
import * as api from './spec.openapi';
const pet = await api.getPet({path: {petId: 'abc'}});
const id: number = pet.id;
const choice: 'yes' | number = pet.choice;
const nullable: string | null = pet.nullable;
const dict: number | undefined = pet.dictionary.a;
// @ts-expect-error operation-level parameter overrides path-level parameter
api.getPet({path: {petId: 1}});
// @ts-expect-error composition retains actual types
const wrong: boolean = pet.choice;
`,
    },
    (_dir, check) => {
      const result = check()
      assert.equal(result.status, 0, result.output)
    },
  )
})

test('nested API and query types do not require operationId', () => {
  const spec = parse(yaml)
  for (const item of Object.values(spec.paths)) {
    for (const operation of Object.values(item)) {
      if (operation && typeof operation === 'object' && !Array.isArray(operation))
        delete operation.operationId
    }
  }
  project(
    {
      'spec.openapi': JSON.stringify(spec),
      'index.ts': `
import { api, query } from './spec.openapi';
const pet = await api.pets.byPetId.get({params: {petId: 1}});
const name: string = pet.name;
query.pets.byPetId.get.queryOptions({input: {params: {petId: 1}}});
// @ts-expect-error input still checked without operationId
api.pets.byPetId.get({params: {petId: 'wrong'}});
`,
    },
    (_dir, check) => {
      const result = check()
      assert.equal(result.status, 0, result.output)
    },
  )
})

test('recursive references remain precise; oRPC headers, dictionaries and void are preserved', () => {
  const reference = (name) => ({ $ref: `#/components/schemas/${name}` })
  const spec = {
    openapi: '3.1.0',
    paths: {
      '/tree': {
        get: {
          responses: { 200: { content: { 'application/json': { schema: reference('Tree') } } } },
        },
      },
      '/json': {
        post: {
          requestBody: {
            required: true,
            content: { 'application/json': { schema: reference('Json') } },
          },
          responses: { 204: { description: 'Done' } },
        },
      },
      '/settings': {
        post: {
          parameters: [
            { in: 'header', name: 'Idempotency-Key', required: true, schema: { type: 'string' } },
          ],
          requestBody: {
            required: true,
            content: { 'application/json': { schema: reference('Settings') } },
          },
          responses: {
            200: { content: { 'application/json': { schema: reference('Settings') } } },
          },
        },
      },
    },
    components: {
      schemas: {
        Tree: {
          type: 'object',
          required: ['name', 'children'],
          properties: {
            name: { type: 'string' },
            children: { type: 'array', items: reference('Tree') },
          },
        },
        Json: {
          anyOf: [
            { type: ['string', 'number', 'boolean', 'null'] },
            { type: 'array', items: reference('Json') },
            { type: 'object', additionalProperties: reference('Json') },
          ],
        },
        Settings: {
          type: 'object',
          properties: { enabled: { type: 'boolean', default: true }, prompt: { type: 'string' } },
          additionalProperties: reference('Json'),
        },
      },
    },
  }
  project(
    {
      'spec.openapi': JSON.stringify(spec),
      'check.ts': `
import { api } from './spec.openapi';
type Tree = Awaited<ReturnType<typeof api.tree.get>>;
type Descend<T, Depth extends unknown[] = []> = Depth['length'] extends 60 ? T : T extends {children: (infer Child)[]} ? Descend<Child, [...Depth, unknown]> : never;
const deepName: string = (null! as Descend<Tree>).name;
// @ts-expect-error deep recursive fields must not become any/unknown
const wrongName: number = (null! as Descend<Tree>).name;
type Json = Parameters<typeof api.json.post>[0]['body'];
type Nest<T, Depth extends unknown[] = []> = Depth['length'] extends 60 ? T : {next: Nest<T, [...Depth, unknown]>};
const good: Json = null! as Nest<string>;
type JsonDescend<T, Depth extends unknown[] = []> = Depth['length'] extends 60 ? T : JsonDescend<Extract<T, Record<string, unknown>>[string], [...Depth, unknown]>;
// @ts-expect-error JSON leaves still reject functions after 60 reference traversals
const bad: JsonDescend<Json> = () => {};
// @ts-expect-error nested functions cannot enter a JSON request
api.json.post({body: {nested: {callback: () => {}}}});
const empty: void = await api.json.post({body: {nested: [null, false, {a: 1}]}});
await api.settings.post({headers: {'Idempotency-Key': 'key'}, body: {prompt: 'hello', custom: [1, null]}});
// @ts-expect-error typed dictionaries do not permit undefined values
await api.settings.post({headers: {'Idempotency-Key': 'key'}, body: {custom: undefined}});
// @ts-expect-error the required request header cannot be omitted
await api.settings.post({body: {}});
// @ts-expect-error nested API uses the oRPC plural headers key
await api.settings.post({header: {'Idempotency-Key': 'key'}, body: {}});
const settings = await api.settings.post({headers: {'Idempotency-Key': 'key'}, body: {}});
const enabled: boolean | undefined = settings.enabled;
// @ts-expect-error a schema default does not guarantee the HTTP response contains a value
const guaranteed: boolean = settings.enabled;
`,
    },
    (_dir, compile) => {
      const result = compile()
      assert.equal(result.status, 0, result.output)
    },
  )
})
