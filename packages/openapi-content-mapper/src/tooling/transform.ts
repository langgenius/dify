import type { Node, Scalar } from 'yaml'
import type { OperationConfigs } from './operation-config.js'
import type { RouterNode } from './router.js'
import type { Selection } from './type-document.js'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { isMap, isScalar, isSeq, parseDocument, visit } from 'yaml'
import { assertDocument, pointer, record, resolveRef } from '../document.js'
import { describeOperations } from '../operation.js'
import { operationConfig } from './operation-config.js'
import { createRouter, routerModule, routerModuleId } from './router.js'
import { operationConfigFile, runtimeConfigFile } from './runtime-config.js'
import { schemaTypes } from './schema-types.js'
import { isSource, resolveDocument } from './source.js'
import { typeDocument } from './type-document.js'

// Positions use UTF-16, as do YAML's ranges and JavaScript string offsets.
export type Mapping = [number, number, number, number, 0 | 1, number]
export type Transform = {
  text: string
  extension: '.ts'
  mappings: Mapping[]
  diagnostics?: { messageText: string; start: number; length: number; code: number }[]
}

function assertObjectKey(node: unknown): asserts node is Scalar<string | number> {
  if (!isScalar(node) || !['string', 'number'].includes(typeof node.value))
    throw new Error('OpenAPI object keys must be strings or numbers')
}

// Both compiler mappings and runtime modules share the same document validation.
function parseSpec(content: string, fileName: string) {
  if (isSource(fileName)) {
    // Exporters produce JSON and have no authored schema coordinates. Avoid
    // allocating a YAML AST and thousands of source mappings we would discard.
    const value: unknown = JSON.parse(content)
    assertDocument(value)
    function validate(node: unknown): void {
      if (typeof node === 'number' && !Number.isFinite(node))
        throw new Error('OpenAPI does not support non-finite numbers')
      if (node && typeof node === 'object') {
        for (const [key, child] of Object.entries(node)) {
          if (key === '$ref' && typeof child === 'string') pointer(value, child)
          validate(child)
        }
      }
    }
    validate(value)
    return { value, router: createRouter(describeOperations(value)), document: undefined }
  }
  // JSON files must be valid JSON, even though YAML is a superset.
  if (fileName.endsWith('.json')) JSON.parse(content)
  const document = parseDocument(content, { uniqueKeys: true, version: '1.2' })
  if (document.errors.length) throw document.errors[0]
  const value: unknown = document.toJS({ maxAliasCount: 0 })
  assertDocument(value)
  visit(document, {
    Alias() {
      throw new Error('YAML aliases are not supported; use OpenAPI $ref')
    },
    Pair(_key, pair) {
      assertObjectKey(pair.key)
      const key = String(pair.key.value)
      if (key === '$ref' && isScalar(pair.value) && typeof pair.value.value === 'string')
        pointer(value, pair.value.value)
    },
    Scalar(_key, node) {
      if (typeof node.value === 'number' && !Number.isFinite(node.value))
        throw new Error('OpenAPI does not support non-finite numbers')
    },
  })
  const operations = describeOperations(value)
  return { document, value, router: createRouter(operations) }
}

export function transformSpec(content: string, fileName: string): Transform {
  try {
    const { document, value, router } = parseSpec(content, fileName)
    // Only the literal type is needed. An initializer makes TS check the entire
    // object expression as well as constructing its type, even for unused routes.
    let text = 'declare const document: '
    const mappings: Mapping[] = []
    const methodNodes = new Map<string, Node>()
    function token(encoded: string, node: Node | null | undefined) {
      const start = text.length
      text += encoded
      if (node?.range) {
        const [from, to] = node.range
        mappings.push([
          start,
          encoded.length,
          from,
          to - from,
          content.slice(from, to) === encoded ? 0 : 1,
          1 | 8 | 16 | 64,
        ])
      }
    }
    function emit(node: Node | null | undefined, selected: Selection, path: string[] = []): void {
      if (isMap(node)) {
        text += '{'
        let separator = ''
        for (const pair of node.items) {
          assertObjectKey(pair.key)
          const key = String(pair.key.value)
          const child = selected.all ? selected : selected.children.get(key)
          if (!child) continue
          text += separator
          separator = ','
          if (path.length === 2 && path[0] === 'paths')
            methodNodes.set(`${path[1]} ${key}`, pair.key)
          token(JSON.stringify(key), pair.key)
          text += ':'
          emit(pair.value as Node | null, child, [...path, key])
        }
        text += '}'
      } else if (isSeq(node)) {
        text += '['
        node.items.forEach((item, index) => {
          if (index) text += ','
          const child = selected.all ? selected : selected.children.get(String(index))
          if (child) emit(item as Node | null, child, [...path, String(index)])
          else text += 'null'
        })
        text += ']'
      } else if (isScalar(node)) {
        token(JSON.stringify(node.value), node)
      } else {
        text += 'null'
      }
    }
    function emitJson(node: unknown, selected: Selection): void {
      if (Array.isArray(node)) {
        text += '['
        node.forEach((item, index) => {
          if (index) text += ','
          const child = selected.all ? selected : selected.children.get(String(index))
          if (child) emitJson(item, child)
          else text += 'null'
        })
        text += ']'
      } else if (node && typeof node === 'object') {
        text += '{'
        let separator = ''
        for (const [key, item] of Object.entries(node)) {
          const child = selected.all ? selected : selected.children.get(key)
          if (!child) continue
          text += `${separator}${JSON.stringify(key)}:`
          separator = ','
          emitJson(item, child)
        }
        text += '}'
      } else {
        text += JSON.stringify(node)
      }
    }
    const selected = typeDocument(value)
    if (document) emit(document.contents, selected)
    else emitJson(value, selected)
    text += ';\n'
    text += schemaTypes(value)
    const config = runtimeConfigFile(fileName)
    text += config
      ? `type Context = import(${JSON.stringify(config)}).Context;\n`
      : 'type Context = object;\n'
    const errors = operationConfigFile(fileName, 'errors')
    text += errors
      ? `type Errors = typeof import(${JSON.stringify(errors)});\n`
      : 'type Errors = object;\n'
    function emitRouter(node: RouterNode) {
      text += '{\n'
      for (const [method, op] of node.methods) {
        const operation = resolveRef(
          resolveRef(record(value.paths)[op.path], value)[op.method],
          value,
        )
        const source = record(operation['x-source-location'])
        if (
          typeof source.file === 'string' &&
          source.file &&
          Number.isSafeInteger(source.line) &&
          Number(source.line) > 0
        ) {
          const input = fileName.startsWith('file:') ? fileURLToPath(fileName) : fileName
          const url = pathToFileURL(resolve(dirname(input), source.file))
          url.hash = `L${source.line}`
          // Encode comment terminators as well as Markdown delimiters in authored filenames.
          const href = url.href.replaceAll('*', '%2A').replaceAll('(', '%28').replaceAll(')', '%29')
          text += `/** [Open backend implementation](${href}) */\n`
        }
        token(JSON.stringify(method), methodNodes.get(`${op.path} ${op.method}`))
        text += `: readonly [${JSON.stringify(op.path)}, ${JSON.stringify(op.method)}];\n`
      }
      for (const [key, child] of node.children) {
        text += `${JSON.stringify(key)}: `
        emitRouter(child)
        text += ';\n'
      }
      text += '}'
    }
    text += 'type Routes = '
    emitRouter(router)
    text += ';\n'
    text +=
      'export declare const api: import("@dify/openapi-content-mapper").RpcRouter<Document, Routes, Context, Errors>;\n'
    text +=
      'export declare const query: import("@dify/openapi-content-mapper").RpcQueryRouter<Document, Routes, Context, Errors>;\n'
    // Exporter output has no source positions in the authored command descriptor.
    return { text, extension: '.ts', mappings: isSource(fileName) ? [] : mappings }
  } catch (error) {
    const position =
      error && typeof error === 'object' && 'pos' in error
        ? (error.pos as [number, number])
        : [0, Math.min(content.length, 1)]
    const start = isSource(fileName) ? 0 : Math.min(content.length, Math.max(0, position[0] ?? 0))
    const end = isSource(fileName)
      ? 0
      : Math.min(content.length, Math.max(start, position[1] ?? start))
    return {
      text: 'declare const invalid: never; export default invalid;',
      extension: '.ts',
      mappings: [],
      diagnostics: [
        {
          messageText: error instanceof Error ? error.message : String(error),
          start,
          length: end - start,
          code: 1001,
        },
      ],
    }
  }
}

export function compileRuntime(
  content: string,
  fileName: string,
  runtimeModule = runtimeConfigFile(fileName),
  namespaceFileName = fileName,
  resolveModule: (file: string) => string = (file) => file,
  sidecarFileName = fileName,
  configs: OperationConfigs = {
    queries: operationConfig(sidecarFileName, 'queries'),
    errors: operationConfig(sidecarFileName, 'errors'),
  },
) {
  const source = resolveDocument(content, fileName)
  const { router } = parseSpec(source.content, fileName)
  const text =
    `export * as api from ${JSON.stringify(routerModuleId(namespaceFileName, []))};\n` +
    `export * as query from ${JSON.stringify(routerModuleId(namespaceFileName, [], true))};\n`
  return Object.assign(
    (routerPath?: string[], query?: boolean | 'errors') =>
      routerPath
        ? routerModule(
            router,
            namespaceFileName,
            routerPath,
            query,
            runtimeModule,
            configs,
            resolveModule,
          )
        : text,
    {
      dependencies: [
        ...source.dependencies,
        ...configs.queries.dependencies,
        ...configs.errors.dependencies,
      ],
    },
  )
}
