/* oxlint-disable vitest/no-import-node-test -- Integration tests exercise the built package in native Node, including its module hooks. */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { parse, parseDocument } from 'yaml'
import { mediaSpec } from './media.mjs'
/* oxlint-enable vitest/no-import-node-test */

const root = resolve(import.meta.dirname, '..')
const compiler = join(root, 'node_modules/typescript/bin/tsc')
const yaml = readFileSync(join(root, 'examples/petstore/pets.openapi.yaml'), 'utf8')

test('document configuration types context for both the API and query namespaces', () => {
  project(
    {
      'pets.yaml': yaml,
      'pets.yaml.config.ts': `
import type { RuntimeConfig } from '@dify/openapi-content-mapper';
export type Context = { silent?: boolean };
const runtime: RuntimeConfig<Context> = {
  queryKeyPrefix: ['console'],
  createClient: ({context}) => {
    const silent: boolean | undefined = context?.silent;
    // @ts-expect-error the runtime factory uses the same context contract as callers
    const wrong: number = context?.silent;
    throw new Error('Type-check only');
  },
};
export default runtime;
`,
      'index.ts': `
import { api, query } from './pets.yaml';
await api.pets.get(undefined, { context: { silent: true } });
query.pets.get.queryOptions({ input: {}, context: { silent: true } });
query.pets.get.queryOptions();
query.pets.get.queryOptions({ staleTime: Infinity });
query.pets.get.queryKey();
// @ts-expect-error required path input cannot be omitted
query.pets.byPetId.get.queryOptions();
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
    run(dir, (...flags) => {
      const result = spawnSync(
        process.execPath,
        [compiler, '-p', dir, '--runExternalCode', '--pretty', 'false', ...flags],
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
import { api, query } from './pets.${extension}';
import * as document from './pets.${extension}';
// @ts-expect-error documents expose only api and query
document.getPet;
import { createTanstackQueryUtils } from '@orpc/tanstack-query';
const wrappedQuery = createTanstackQueryUtils(api);
const fromWrapped: typeof query.pets.byPetId.get = wrappedQuery.pets.byPetId.get;
const toWrapped: typeof wrappedQuery.pets.byPetId.get = query.pets.byPetId.get;
// The document helpers also preserve optional inputs that generic client inference loses.
query.pets.get.queryOptions();
const generatedOptions = query.pets.byPetId.get.queryOptions({ input: { params: { petId: 1 } } });
const generatedKey = query.pets.key();
// @ts-expect-error generated query helpers retain parameter types
query.pets.byPetId.get.queryOptions({ input: { params: { petId: 'wrong' } } });
const queryOptions = wrappedQuery.pets.byPetId.get.queryOptions({ input: { params: { petId: 1 } } });
type QueryResult = Awaited<ReturnType<typeof queryOptions.queryFn>>;
const queryName: string = (null! as QueryResult).name;
// @ts-expect-error wrapped query helpers retain required parameter types
wrappedQuery.pets.byPetId.get.queryOptions({ input: { params: { petId: 'wrong' } } });
const pet = await api.pets.byPetId.get({ params: { petId: 1 } });
const name: string = pet.name;
const id: number = pet.id;
const state: 'available' | 'adopted' = pet.status;
const nickname: string | null | undefined = pet.nickname;
const pets = await api.pets.get();
const item: typeof pet = pets[0]!;
const created: typeof pet = await api.pets.post({ body: { name: 'Mochi' } });
const deleted: void = await api.pets.byPetId.delete({ params: { petId: 1 } });
await api.pets.get({ query: { limit: 10, status: 'available' } });
type IsAny<T> = 0 extends (1 & T) ? true : false;
const notAny: IsAny<typeof pet> = false;
// @ts-expect-error response must not silently become any
const wrong: number = pet.name;
// @ts-expect-error no invented response fields
pet.missing;
// @ts-expect-error required path group
api.pets.byPetId.get();
// @ts-expect-error required path parameter
api.pets.byPetId.get({ params: {} });
// @ts-expect-error integer parameter
api.pets.byPetId.get({ params: { petId: '1' } });
// @ts-expect-error unknown operation
api.unknown();
// @ts-expect-error enum values retained from file
api.pets.get({ query: { status: 'lost' } });
// @ts-expect-error no undeclared query arguments
api.pets.get({ query: { invented: true } });
// @ts-expect-error required body
api.pets.post();
// @ts-expect-error required property in body
api.pets.post({ body: {} });
// @ts-expect-error no body on GET
api.pets.get({ body: {} });
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
import { api } from './pets.yaml';
const pet = await api.pets.byPetId.get({params: {petId: 1}});
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

test('unused operations do not eagerly instantiate API or query signatures', () => {
  const instantiations = []
  for (const count of [0, 1000]) {
    const spec = parse(yaml)
    for (let i = 0; i < count; i++) {
      spec.paths[`/unused-${i}`] = {
        get: {
          parameters: [{ name: 'id', in: 'query', required: true, schema: { type: 'integer' } }],
          responses: {
            200: {
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Pet' } } },
            },
          },
        },
      }
    }
    project(
      {
        'spec.openapi': JSON.stringify(spec),
        'index.ts': `import { api, query } from './spec.openapi';
const name: string = (await api.pets.byPetId.get({params: {petId: 1}})).name;
query.pets.byPetId.get.queryOptions({input: {params: {petId: 1}}});`,
      },
      (_dir, check) => {
        const result = check('--extendedDiagnostics')
        assert.equal(result.status, 0, result.output)
        const match = result.output.match(/Instantiations:\s+(\d+)/)
        assert(match, result.output)
        instantiations.push(Number(match[1]))
      },
    )
  }
  assert(instantiations[1] - instantiations[0] < 1000, JSON.stringify(instantiations))
})

test('cached mapper output follows sidecar additions, edits and removals', () => {
  project(
    {
      'pets.yaml': yaml,
      'index.ts': `import { api } from './pets.yaml';
api.pets.get(undefined, {context: {token: 'secret'}});`,
    },
    (dir, check) => {
      assert.equal(check().status, 0)
      const sidecar = join(dir, 'pets.yaml.config.ts')
      writeFileSync(sidecar, 'export type Context = { token: number };')
      assert.notEqual(check().status, 0)
      writeFileSync(sidecar, 'export type Context = { token: string };')
      const edited = check()
      assert.equal(edited.status, 0, edited.output)
      rmSync(sidecar)
      const removed = check()
      assert.equal(removed.status, 0, removed.output)
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
  spec.paths['/literal'] = {
    get: {
      responses: {
        200: {
          content: {
            'application/json': { schema: { const: { name: 'fixed', values: [1, true] } } },
          },
        },
      },
    },
  }
  project(
    {
      'spec.openapi': JSON.stringify(spec),
      'index.ts': `
import { api } from './spec.openapi';
const pet = await api.pets.byPetId.get({params: {petId: 'abc'}});
const id: number = pet.id;
const choice: 'yes' | number = pet.choice;
const nullable: string | null = pet.nullable;
const dict: number | undefined = pet.dictionary.a;
const literal = await api.literal.get();
const fixed: 'fixed' = literal.name;
const first: 1 = literal.values[0];
// @ts-expect-error literal objects retain their original readonly semantics
literal.name = 'fixed';
// @ts-expect-error nested literal tuples remain readonly too
literal.values.push(1);
// @ts-expect-error operation-level parameter overrides path-level parameter
api.pets.byPetId.get({params: {petId: 1}});
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

test('JSON responses use wire strings and request media selects a matching body', () => {
  project(
    {
      'media.openapi': JSON.stringify(mediaSpec),
      'index.ts': `
import { api, query } from './media.openapi';
const wildcard: Blob = await api.wildcard.get();
await wildcard.arrayBuffer();
const textWildcard: string = await api.textWildcard.get();
// @ts-expect-error a binary wildcard cannot promise decoded text
const wrongWildcard: string = await api.wildcard.get();
const response = await api.binary.get();
const inline: string = response.inline;
const referenced: string = response.referenced;
const vendorBinary: string = await api.vendorBinary.get();
// @ts-expect-error JSON decoding does not construct Blob instances
const blob: Blob = response.referenced;
// @ts-expect-error inline JSON binary schemas also remain strings
response.inline.arrayBuffer();
await api.mixed.post({body: {kind: 'standard'}});
await api.mixed.post({body: {kind: 'vendor'}, contentType: 'application/vnd.example+json'});
await api.mixed.post({body: {kind: 'form'}, contentType: 'multipart/form-data'});
// @ts-expect-error only the application/json branch may omit its media type
api.mixed.post({body: {kind: 'vendor'}});
// @ts-expect-error content type and body must belong to the same branch
api.mixed.post({body: {kind: 'vendor'}, contentType: 'application/json'});
// @ts-expect-error multipart remains explicit when JSON is also declared
api.mixed.post({body: {kind: 'form'}});
await api.single.post({body: {kind: 'single'}});
await api.optionalVendors.post();
// @ts-expect-error an optional body still requires a media type when provided
api.optionalVendors.post({body: {kind: 'second'}});
await api.vendors.post({body: {kind: 'first'}, contentType: 'application/vnd.first+json'});
// @ts-expect-error multiple vendor types have no implicit default
api.vendors.post({body: {kind: 'second'}});
query.mixed.post.queryOptions({input: {body: {kind: 'vendor'}, contentType: 'application/vnd.example+json'}});
// @ts-expect-error query helpers preserve the same media/body discrimination
query.mixed.post.queryOptions({input: {body: {kind: 'vendor'}}});
`,
    },
    (_dir, compile) => {
      const result = compile()
      assert.equal(result.status, 0, result.output)
    },
  )
})

test('API and query errors narrow to the selected operation map, including re-exports', () => {
  project(
    {
      'pets.yaml': yaml,
      'errors.ts': `
import { type } from '@orpc/contract';
export const conflicts = { CONFLICT: { status: 409, data: type<{ revision: number }>() } };
`,
      'pets.yaml.errors.ts': `export { conflicts as 'GET /pets' } from './errors.js';`,
      'index.ts': `
import { safe } from '@orpc/client';
import { api, query } from './pets.yaml';
const [error, , defined] = await safe(api.pets.get());
if (defined) {
  const code: 'CONFLICT' = error.code;
  const revision: number = error.data.revision;
  // @ts-expect-error other error payloads must not leak into this operation
  error.data.reason;
}
query.pets.get.queryOptions({ input: {}, retry: (_count, failure) => {
  if (failure instanceof Error && 'defined' in failure && failure.defined) {
    const code: 'CONFLICT' = failure.code;
    const revision: number = failure.data.revision;
  }
  return false;
} });
const [other, , otherDefined] = await safe(api.pets.byPetId.get({ params: { petId: 1 } }));
if (otherDefined) {
  // @ts-expect-error this operation has no documented conflict
  other.data.revision;
}
`,
    },
    (_dir, compile) => {
      const result = compile()
      assert.equal(result.status, 0, result.output)
    },
  )
})
