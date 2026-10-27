/* oxlint-disable vitest/no-import-node-test -- Integration tests exercise the built package in native Node, including its module hooks. */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { parse, parseDocument } from 'yaml'
import { mediaSpec, multipartSpec, variantSpec } from './media.mjs'
/* oxlint-enable vitest/no-import-node-test */

const root = resolve(import.meta.dirname, '..')
const compiler = join(root, 'node_modules/typescript/bin/tsc')
const yaml = readFileSync(join(root, 'examples/petstore/pets.openapi.yaml'), 'utf8')

test('oneOf rejects overlapping required branches and enum values without narrowing anyOf', () => {
  const ref = (name) => ({ $ref: `#/components/schemas/${name}` })
  const operation = (schema) => ({
    post: {
      requestBody: { required: true, content: { 'application/json': { schema } } },
      responses: { 200: { content: { 'application/json': { schema } } } },
    },
  })
  const properties = {
    email: { type: 'string', nullable: true },
    phone: { type: 'string' },
    id: { type: 'number' },
    next: ref('Exclusive'),
  }
  const choices = [{ required: ['email'] }, { required: ['phone'] }]
  const exclusive = { type: 'object', properties, oneOf: choices }
  project(
    {
      'spec.openapi': JSON.stringify({
        openapi: '3.1.0',
        components: { schemas: { Exclusive: exclusive } },
        paths: {
          '/inline': operation(exclusive),
          '/open': operation({ ...exclusive, additionalProperties: true }),
          '/aliased': operation(ref('Exclusive')),
          '/inclusive': operation({ type: 'object', properties, anyOf: choices }),
          '/triple': operation({
            type: 'object',
            properties,
            oneOf: [...choices, { required: ['id'] }],
          }),
          '/grouped': operation({
            type: 'object',
            properties,
            oneOf: [{ anyOf: choices }, { required: ['id'] }],
          }),
          '/duplicate': operation({ type: 'object', properties, oneOf: [choices[0], choices[0]] }),
          '/enum': operation({ oneOf: [{ enum: ['A', 'B'] }, { enum: ['B', 'C'] }] }),
          '/tagged': operation({
            type: 'object',
            properties: { ...properties, kind: { type: 'string' } },
            oneOf: [
              { properties: { kind: { const: 'email' } }, required: ['kind', 'email'] },
              { properties: { kind: { const: 'phone' } }, required: ['kind', 'phone'] },
            ],
          }),
        },
      }),
      'index.ts': `
import {api,query} from './spec.openapi';
import type {InferSchema} from '@dify/openapi-content-mapper';
api.inline.post({body:{email:'a@example.test'}});
api.open.post({body:{email:'a@example.test',extra:42}});
// @ts-expect-error an index signature does not erase known required keys
api.open.post({body:{email:'ok',phone:'123'}});
api.aliased.post({body:{phone:'123'}});
api.inline.post({body:{email:null,phone:undefined,next:{phone:'nested'}}});
api.inclusive.post({body:{email:null,phone:'123'}});
api.triple.post({body:{id:42}});
api.grouped.post({body:{email:'ok',phone:'123'}});
api.grouped.post({body:{id:42}});
api.tagged.post({body:{kind:'email',email:'ok',phone:'allowed by distinct discriminator'}});
api.enum.post({body:'A'});
api.enum.post({body:'C'});
const result = await api.aliased.post({body:{email:null}});
const deep:string|null|undefined = result.next!.next!.email;
// @ts-expect-error matching both required branches violates oneOf
api.inline.post({body:{email:'ok',phone:'123'}});
// @ts-expect-error generated aliases enforce the same exclusivity
api.aliased.post({body:{email:null,phone:'123'}});
// @ts-expect-error recursive oneOf retains exclusivity
api.inline.post({body:{email:'ok',next:{email:'nested',phone:'123'}}});
// @ts-expect-error matching no branches also violates oneOf
api.inline.post({body:{}});
// @ts-expect-error missing a required value remains invalid
api.inline.post({body:{email:undefined}});
// @ts-expect-error every pair is excluded for three alternatives
api.triple.post({body:{phone:'123',id:42}});
// @ts-expect-error exclude every member of the other branch's union
api.grouped.post({body:{email:'ok',id:42}});
// @ts-expect-error the other union member is excluded too
api.grouped.post({body:{phone:'123',id:42}});
// @ts-expect-error duplicate matching branches cannot match exactly once
api.duplicate.post({body:{email:'ok'}});
// @ts-expect-error an overlapping enum value matches both branches
api.enum.post({body:'B'});
// @ts-expect-error query helpers retain exclusivity
query.inline.post.mutationOptions().mutationFn!({body:{email:'ok',phone:'123'}},null!);
type Direct=InferSchema<{type:'object',properties:{a:{type:'string'},b:{type:'string'}},oneOf:[{required:['a']},{required:['b']}]} >;
const valid:Direct={a:'ok'};
// @ts-expect-error public inference shares exclusive branch handling
const invalid:Direct={a:'ok',b:'wrong'};
`,
    },
    (_dir, check) => {
      const result = check()
      assert.equal(result.status, 0, result.output)
    },
  )
})

test('ambiguous JSON defaults and multipart variants retain distinct inputs', () => {
  project(
    {
      'spec.openapi': JSON.stringify(variantSpec),
      'index.ts': `
import {api,query} from './spec.openapi';
api.json.post({body:'A',contentType:'application/json; profile="A"'});
api.json.post({body:'B',contentType:'application/json; profile="B"'});
// @ts-expect-error neither JSON variant is an unambiguous default
api.json.post({body:'A'});
// @ts-expect-error profile B cannot silently use profile A
api.json.post({body:'B'});
// @ts-expect-error profile and payload must match
api.json.post({body:'B',contentType:'application/json; profile="A"'});
// @ts-expect-error query helpers must also select a variant
query.json.post.mutationOptions().mutationFn!({body:'B'},null!);
api.form.post({body:{metadata:'wire text'},contentType:'multipart/form-data; profile="json"'});
api.form.post({body:{metadata:new File(['bytes'],'metadata.bin')},contentType:'multipart/form-data; profile="file"'});
// @ts-expect-error only the JSON variant accepts wire strings
api.form.post({body:{metadata:'wire text'},contentType:'multipart/form-data; profile="file"'});
// @ts-expect-error only the file variant accepts Blob
api.form.post({body:{metadata:new Blob()},contentType:'multipart/form-data; profile="json"'});
`,
    },
    (_dir, check) => {
      const result = check()
      assert.equal(result.status, 0, result.output)
    },
  )
})

test('required-only alternatives retain branch semantics in inline, aliased and nested schemas', () => {
  const ref = (name) => ({ $ref: `#/components/schemas/${name}` })
  const operation = (schema) => ({
    post: {
      requestBody: { required: true, content: { 'application/json': { schema } } },
      responses: { 200: { content: { 'application/json': { schema } } } },
    },
  })
  for (const openapi of ['3.0.3', '3.1.0']) {
    const properties = {
      email: { type: 'string', nullable: true },
      phone: { type: 'string' },
      next: ref('Contact'),
    }
    const either = { anyOf: [{ required: ['email'] }, ref('Phone')] }
    const contact = { type: 'object', properties, ...either }
    const spec = {
      openapi,
      components: {
        schemas: {
          Phone: { required: ['phone'] },
          Either: either,
          Contact: contact,
          Fields: { type: 'object', properties },
          Nested: { allOf: [ref('Either'), ref('Fields')] },
          Exclusive: { type: 'object', properties, oneOf: either.anyOf },
        },
      },
      paths: {
        '/inline': operation(contact),
        '/aliased': operation(ref('Contact')),
        '/nested': operation(ref('Nested')),
        '/exclusive': operation(ref('Exclusive')),
        '/mixed': operation({ type: ['object', 'string', 'null'], properties, ...either }),
        '/typed': operation({
          type: 'object',
          properties: { email: { type: 'string' } },
          anyOf: [{ type: 'string' }, { required: ['email'] }],
        }),
        '/unconstrained': operation({ type: 'object', properties, anyOf: [{}, ref('Phone')] }),
      },
    }
    project(
      {
        'spec.openapi': JSON.stringify(spec),
        'index.ts': `
import {api,query} from './spec.openapi';
import type {InferSchema} from '@dify/openapi-content-mapper';
api.inline.post({body:{email:'a@example.test'}});
api.aliased.post({body:{phone:'123'}});
api.inline.post({body:{email:null,phone:'123',next:{email:'nested'}}});
api.nested.post({body:{email:null}});
api.exclusive.post({body:{phone:'123'}});
api.mixed.post({body:'required only constrains objects'});
api.mixed.post({body:null});
api.unconstrained.post({body:{}});
const result = await api.aliased.post({body:{email:null}});
const email:string|null|undefined = result.email;
const deep:string|null|undefined = result.next!.next!.email;
// @ts-expect-error at least one contact field is required
api.inline.post({body:{}});
// @ts-expect-error aliases preserve required-only alternatives
api.aliased.post({body:{}});
// @ts-expect-error nested allOf combines fields before applying alternatives
api.nested.post({body:{}});
// @ts-expect-error oneOf must match at least one branch
api.exclusive.post({body:{}});
// @ts-expect-error undefined does not satisfy required
api.inline.post({body:{email:undefined}});
// @ts-expect-error preserve inherited property types
api.inline.post({body:{email:42}});
// @ts-expect-error recursive alternatives remain enforced
api.aliased.post({body:{phone:'123',next:{}}});
// @ts-expect-error the scalar branch cannot satisfy an object schema
api.typed.post({body:{}});
// @ts-expect-error query helpers share the same branch constraints
query.inline.post.mutationOptions().mutationFn!({body:{}},null!);
type Contact = InferSchema<{type:'object',properties:{email:{type:'string'},phone:{type:'string'}},anyOf:[{required:['email']},{required:['phone']}]} >;
const direct:Contact = {phone:'ok'};
// @ts-expect-error direct schema inference rejects missing required branches
const invalid:Contact = {};
`,
      },
      (_dir, check) => {
        const result = check()
        assert.equal(result.status, 0, result.output)
      },
    )
  }
})

test('allOf applies required-only constraints after combining property types', () => {
  const ref = (name) => ({ $ref: `#/components/schemas/${name}` })
  const composed = { allOf: [ref('Constraint'), ref('User')] }
  const operation = (schema) => ({
    requestBody: { required: true, content: { 'application/json': { schema } } },
    responses: { 200: { content: { 'application/json': { schema } } } },
  })
  for (const openapi of ['3.0.3', '3.1.0']) {
    project(
      {
        'spec.openapi': JSON.stringify({
          openapi,
          components: {
            schemas: {
              Constraint: { allOf: [{ required: ['name'] }] },
              User: {
                type: 'object',
                properties: {
                  name: { type: 'string', nullable: true },
                  next: ref('Composed'),
                },
              },
              Composed: composed,
            },
          },
          paths: {
            '/inline': { post: operation(composed) },
            '/aliased': { post: operation(ref('Composed')) },
            '/direct': { post: operation({ allOf: [ref('User'), { required: ['name'] }] }) },
            '/scalar': { post: operation({ allOf: [{ type: 'string' }, ref('Constraint')] }) },
            '/array': {
              post: operation({
                allOf: [{ type: 'array', items: { type: 'number' } }, ref('Constraint')],
              }),
            },
          },
        }),
        'index.ts': `
import { api, query } from './spec.openapi';
import type { InferSchema } from '@dify/openapi-content-mapper';
const inline = await api.inline.post({body:{name:null,next:{name:'nested'}}});
const name: string | null = inline.name;
const nestedName: string | null = inline.next!.next!.name;
const aliased = await api.aliased.post({body:{name:'ok'}});
const aliasName: string | null = aliased.name;
api.scalar.post({body:'required does not constrain scalars'});
api.array.post({body:[1,2]});
// @ts-expect-error constraints inside referenced allOf must reject empty objects
api.inline.post({body:{}});
// @ts-expect-error generated aliases enforce the same constraints
api.aliased.post({body:{}});
// @ts-expect-error direct required-only allOf branch
api.direct.post({body:{}});
// @ts-expect-error undefined disappears during serialization
api.inline.post({body:{name:undefined}});
// @ts-expect-error preserve property types
api.inline.post({body:{name:123}});
// @ts-expect-error recursive constraints remain required
api.inline.post({body:{name:'ok',next:{}}});
// @ts-expect-error query helpers share the same input types
query.inline.post.mutationOptions().mutationFn!({body:{}},null!);
type Direct = InferSchema<{allOf:[{required:['name']},{type:'object',properties:{name:{type:'string'}}}]} >;
// @ts-expect-error public schema inference also applies composition constraints
const direct: Direct = {};
const valid: Direct = {name:'ok'};
`,
      },
      (_dir, check) => {
        const result = check()
        assert.equal(result.status, 0, result.output)
      },
    )
  }
})

test('URI-encoded schema and structural references preserve inferred types', () => {
  const schema = {
    type: 'object',
    required: ['name', 'number', 'literal'],
    properties: {
      name: { $ref: '#/components/schemas/Model/properties/display%20name' },
      number: { $ref: '#%2Fcomponents/schemas/Model/properties/%E9%9B%AA~1~0%2520' },
      literal: { const: { $ref: '#/literal/%ZZ' } },
    },
  }
  const spec = {
    openapi: '3.1.0',
    paths: {
      '/payload': {
        post: {
          parameters: [{ $ref: '#/components/parameters/%51uery' }],
          requestBody: { $ref: '#/components/requestBodies/%49nput' },
          responses: { 200: { $ref: '#/components/responses/%4Futput' } },
        },
      },
      '/copy': { $ref: '#/paths/%7E1payload' },
    },
    components: {
      schemas: {
        Model: {
          type: 'object',
          properties: {
            'display name': { type: 'string' },
            '雪/~%20': { type: 'number' },
          },
        },
      },
      parameters: {
        Query: { name: 'limit', in: 'query', required: true, schema: { type: 'number' } },
      },
      requestBodies: { Input: { required: true, content: { 'application/json': { schema } } } },
      responses: { Output: { description: 'OK', content: { 'application/json': { schema } } } },
    },
  }
  project(
    {
      'spec.openapi': JSON.stringify(spec),
      'index.ts': `
import { api } from './spec.openapi';
const body = {name:'ok',number:42,literal:{$ref:'#/literal/%ZZ' as const}};
const result = await api.payload.post({body,query:{limit:1}});
const name:string = result.name;
const number:number = result.number;
const literal:'#/literal/%ZZ' = result.literal.$ref;
api.copy.post({body,query:{limit:1}});
// @ts-expect-error referenced structural parameters remain required
api.copy.post({body});
// @ts-expect-error encoded schema references keep their property types
api.payload.post({body:{...body,number:'wrong'},query:{limit:1}});
`,
    },
    (_dir, check) => {
      const result = check()
      assert.equal(result.status, 0, result.output)
    },
  )
})

test('parameterized media types keep codecs and declared request keys aligned', () => {
  const spec = { openapi: '3.1.0', paths: {} }
  for (const [name, media] of [
    ['json', 'Application/JSON ; charset=utf-8'],
    ['vendor', 'application/vnd.test+json; profile="CaseSensitive"'],
    ['stream', 'text/event-stream; charset=utf-8'],
    ['binary', 'application/octet-stream; version=1'],
  ]) {
    spec.paths[`/${name}`] = {
      get: {
        responses: {
          200: {
            content: {
              [media]: { schema: { type: 'string', format: 'binary' } },
            },
          },
        },
      },
    }
  }
  spec.paths['/json'].post = {
    requestBody: {
      required: true,
      content: {
        'Application/JSON ; charset=utf-8': { schema: { type: 'string', format: 'binary' } },
        'application/vnd.test+json; profile="CaseSensitive"': { schema: { type: 'number' } },
      },
    },
    responses: { 204: { description: 'Done' } },
  }
  spec.paths['/form'] = {
    post: {
      requestBody: {
        required: true,
        content: {
          'multipart/form-data': {
            schema: {
              type: 'object',
              required: ['metadata'],
              properties: {
                metadata: { type: 'string', format: 'binary' },
              },
            },
            encoding: { metadata: { contentType: 'application/json; charset=utf-8' } },
          },
        },
      },
      responses: { 204: { description: 'Done' } },
    },
  }
  project(
    {
      'spec.openapi': JSON.stringify(spec),
      'index.ts': `
import { api } from './spec.openapi';
const json:string = await api.json.get();
const vendor:string = await api.vendor.get();
const stream:ReadableStream<Uint8Array> = await api.stream.get();
const binary:Blob = await api.binary.get();
api.json.post({body:'wire string'});
api.json.post({body:42,contentType:'application/vnd.test+json; profile="CaseSensitive"'});
api.form.post({body:{metadata:'wire string'}});
// @ts-expect-error declared parameters remain part of the selectable request key
api.json.post({body:42,contentType:'application/vnd.test+json'});
// @ts-expect-error JSON binary formats remain wire strings
api.json.post({body:new Blob()});
// @ts-expect-error parameterized JSON parts also use wire strings
api.form.post({body:{metadata:new Blob()}});
`,
    },
    (_dir, check) => {
      const result = check()
      assert.equal(result.status, 0, result.output)
    },
  )
})

test('JSON multipart parts use wire strings while file parts retain Blob types', () => {
  project(
    {
      'spec.openapi': JSON.stringify(multipartSpec),
      'index.ts': `
import { api, query } from './spec.openapi';
const body = {file:new File(['bytes'],'upload.bin'),metadata:{content:'wire',nullable:null,next:{content:'nested'}},parts:['one','two']};
api.uploadInline.post({body});
api.uploadRef.post({body:{...body,optional:'optional'}});
query.uploadRef.post.mutationOptions().mutationFn!({body},null!);
type Input = Parameters<typeof api.uploadRef.post>[0]['body'];
const file: Blob = (null! as Input).file;
const nullable: string | null | undefined = (null! as Input).metadata.nullable;
const optional: string | undefined = (null! as Input).optional;
const deep: string = (null! as Input).metadata.next!.next!.content;
// @ts-expect-error JSON encoded fields do not accept Blob
api.uploadInline.post({body:{...body,metadata:{content:new Blob(['lost'])}}});
// @ts-expect-error referenced JSON encoded fields do not accept Blob
api.uploadRef.post({body:{...body,metadata:{content:new Blob(['lost'])}}});
// @ts-expect-error a normal file part still requires Blob
api.uploadRef.post({body:{...body,file:'not a file'}});
// @ts-expect-error optional JSON part is a string if present
api.uploadRef.post({body:{...body,optional:new Blob(['lost'])}});
// @ts-expect-error arrays inside JSON parts use strings too
api.uploadRef.post({body:{...body,parts:[new Blob(['lost'])]}});
// @ts-expect-error the required JSON part remains required
api.uploadRef.post({body:{file:body.file,parts:[]}});
`,
    },
    (_dir, check) => {
      const result = check()
      assert.equal(result.status, 0, result.output)
    },
  )
})

test('media type inference is case-insensitive while contentType retains declared keys', () => {
  const spec = { openapi: '3.1.0', paths: {} }
  for (const [name, media] of [
    ['json', 'Application/JSON'],
    ['vendor', 'Application/Problem+JSON'],
    ['text', 'TEXT/PLAIN'],
    ['stream', 'Text/Event-Stream'],
    ['binary', 'Application/Octet-Stream'],
  ]) {
    spec.paths[`/${name}`] = {
      get: {
        responses: {
          200: { description: 'OK', content: { [media]: { schema: { type: 'string' } } } },
        },
      },
    }
  }
  spec.paths['/json'].post = {
    requestBody: {
      required: true,
      content: {
        'Application/JSON': { schema: { type: 'string' } },
        'Application/Vnd.Test+JSON': { schema: { type: 'number' } },
      },
    },
    responses: { 204: { description: 'OK' } },
  }
  project(
    {
      'spec.openapi': JSON.stringify(spec),
      'index.ts': `
import {api} from './spec.openapi';
const json:string=await api.json.get();
const vendor:string=await api.vendor.get();
const text:string=await api.text.get();
const stream:ReadableStream<Uint8Array>=await api.stream.get();
const binary:Blob=await api.binary.get();
api.json.post({body:'default JSON'});
api.json.post({body:123,contentType:'Application/Vnd.Test+JSON'});
// @ts-expect-error vendor JSON needs an explicit content type
api.json.post({body:123});
`,
    },
    (_dir, check) => {
      const result = check()
      assert.equal(result.status, 0, result.output)
    },
  )
})

test('required siblings preserve referenced property types, nullability and recursion', () => {
  const ref = (name) => ({ $ref: `#/components/schemas/${name}` })
  const required = { ...ref('User'), required: ['name'] }
  const operation = (schema) => ({
    requestBody: { required: true, content: { 'application/json': { schema } } },
    responses: { 200: { description: 'OK', content: { 'application/json': { schema } } } },
  })
  for (const version of ['3.1.0', '3.0.3']) {
    const spec = {
      openapi: version,
      components: {
        schemas: {
          User: {
            type: 'object',
            properties: {
              name: { type: 'string', nullable: true },
              next: ref('Required'),
            },
          },
          Required: required,
          Composed: { allOf: [ref('User')], required: ['name'] },
          Scalar: { type: 'string' },
          RequiredScalar: { ...ref('Scalar'), required: ['name'] },
        },
      },
      paths: {
        '/inline': { post: operation(required) },
        '/aliased': { post: operation(ref('Required')) },
        '/composed': { post: operation(ref('Composed')) },
        '/scalar': { post: operation(ref('RequiredScalar')) },
      },
    }
    project(
      {
        'spec.openapi': JSON.stringify(spec),
        'index.ts': `
import { api, query } from './spec.openapi';
const result = await api.inline.post({body:{name:null}});
const named: ${version.startsWith('3.1.') ? 'string | null' : 'string | null | undefined'} = result.name;
const aliased = await api.aliased.post({body:{name:'Mochi',next:{name:null}}});
const aliasName: typeof named = aliased.name;
const recursiveName: typeof named = aliased.next!.next!.name;
api.scalar.post({body:'required applies only to objects'});
${version.startsWith('3.1.') ? '// @ts-expect-error required sibling rejects missing name' : ''}
api.inline.post({body:{}});
${version.startsWith('3.1.') ? '// @ts-expect-error referenced required sibling rejects missing name' : ''}
api.aliased.post({body:{}});
${version.startsWith('3.1.') ? '// @ts-expect-error undefined would disappear during JSON serialization' : ''}
api.aliased.post({body:{name:undefined}});
${version.startsWith('3.1.') ? '// @ts-expect-error nested recursive reference preserves required sibling' : ''}
api.aliased.post({body:{name:'ok',next:{}}});
${version.startsWith('3.1.') ? '// @ts-expect-error query helper retains required sibling' : ''}
query.inline.post.mutationOptions().mutationFn!({body:{}},null!);
const composed = await api.composed.post({body:{name:null}});
const composedName: string | null = composed.name;
// @ts-expect-error required also applies after allOf composition
api.composed.post({body:{}});
// @ts-expect-error required preserves the actual property type
api.inline.post({body:{name:123}});
`,
      },
      (_dir, check) => {
        const result = check()
        assert.equal(result.status, 0, result.output)
      },
    )
  }
})

test('empty object schemas reject primitive and array bodies in inline and aliased forms', () => {
  const operation = (schema) => ({
    requestBody: { required: true, content: { 'application/json': { schema } } },
    responses: { 200: { description: 'OK', content: { 'application/json': { schema } } } },
  })
  const spec = {
    openapi: '3.1.0',
    components: {
      schemas: {
        Open: { type: 'object' },
        Closed: { type: 'object', additionalProperties: false },
      },
    },
    paths: {
      '/inline': { post: operation({ type: 'object' }) },
      '/aliased': { post: operation({ $ref: '#/components/schemas/Open' }) },
      '/closed': { post: operation({ $ref: '#/components/schemas/Closed' }) },
      '/inline-closed': { post: operation({ type: 'object', additionalProperties: false }) },
    },
  }
  project(
    {
      'spec.openapi': JSON.stringify(spec),
      'index.ts': `
import { api, query } from './spec.openapi';
api.inline.post({body:{}});
api.aliased.post({body:{custom:[1,null,{nested:true}]}});
api.closed.post({body:{}});
api.inlineClosed.post({body:{}});
// @ts-expect-error JSON object is not a number
api.inline.post({body:123});
// @ts-expect-error JSON object is not an array
api.aliased.post({body:[]});
// @ts-expect-error JSON object is not a string
api.aliased.post({body:'text'});
// @ts-expect-error JSON object is not null
api.inline.post({body:null});
// @ts-expect-error closed empty objects reject properties
api.closed.post({body:{extra:true}});
// @ts-expect-error inline closed empty objects also reject properties
api.inlineClosed.post({body:{extra:true}});
// @ts-expect-error query helpers retain the object constraint
query.inline.post.mutationOptions().mutationFn!({body:false},null!);
`,
    },
    (_dir, check) => {
      const result = check()
      assert.equal(result.status, 0, result.output)
    },
  )
})

test('3.1 reference siblings narrow inline and aliased schemas without changing 3.0 references', () => {
  for (const version of ['3.1.0', '3.0.3']) {
    const narrow = { $ref: '#/components/schemas/Status', enum: ['ready'] }
    const operation = (schema) => ({
      requestBody: { required: true, content: { 'application/json': { schema } } },
      responses: { 200: { description: 'OK', content: { 'application/json': { schema } } } },
    })
    const spec = {
      openapi: version,
      components: {
        schemas: {
          Status: { type: 'string', enum: ['ready', 'deleted'] },
          Narrow: narrow,
        },
      },
      paths: {
        '/inline': { post: operation(narrow) },
        '/referenced': { post: operation({ $ref: '#/components/schemas/Narrow' }) },
      },
    }
    project(
      {
        'spec.openapi': JSON.stringify(spec),
        'index.ts': `
import { api, query } from './spec.openapi';
const inline: ${version.startsWith('3.1.') ? "'ready'" : "'ready' | 'deleted'"} = await api.inline.post({body:'ready'});
const referenced: typeof inline = await api.referenced.post({body:'ready'});
${version.startsWith('3.1.') ? '// @ts-expect-error sibling enum narrows inline input' : ''}
api.inline.post({body:'deleted'});
${version.startsWith('3.1.') ? '// @ts-expect-error sibling enum narrows aliased input' : ''}
api.referenced.post({body:'deleted'});
${version.startsWith('3.1.') ? '// @ts-expect-error query inputs share reference constraints' : ''}
query.referenced.post.mutationOptions().mutationFn!({body:'deleted'}, null!);
`,
      },
      (_dir, check) => {
        const result = check()
        assert.equal(result.status, 0, result.output)
      },
    )
  }
})

test('schema-less binary requests accept Blob and schema-less JSON stays unknown', () => {
  const spec = {
    openapi: '3.1.0',
    paths: {
      '/upload': {
        post: {
          requestBody: { required: true, content: { 'application/octet-stream': {} } },
          responses: { 200: { description: 'OK', content: { 'application/json': {} } } },
        },
      },
    },
  }
  project(
    {
      'spec.openapi': JSON.stringify(spec),
      'index.ts': `
import { api, query } from './spec.openapi';
const result = await api.upload.post({body:new Blob(['bytes'])});
query.upload.post.mutationOptions().mutationFn!({body:new File(['bytes'], 'test.bin')}, null!);
// @ts-expect-error binary requests require bytes, not a JSON string
api.upload.post({body:'bytes'});
// @ts-expect-error required binary body cannot be omitted
api.upload.post();
// @ts-expect-error missing JSON schema must not produce never
const unsafe: number = result;
`,
    },
    (_dir, check) => {
      const result = check()
      assert.equal(result.status, 0, result.output)
    },
  )
})

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
