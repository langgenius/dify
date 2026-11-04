import type { OpenApiDocument } from './types.js'
import { assertDocument, record, resolveRef } from './document.js'

export type Parameter = {
  name: string
  in: string
  required: boolean
  style: string
  explode: boolean
}
export type OperationDescriptor = {
  method: string
  /** Optional public member path; used only while constructing the module graph. */
  clientPath?: string[]
  path: string
  parameters?: Parameter[]
  baseUrl?: string
  contentType?: string
  contentTypes?: string[]
  multipartJson?: string[]
  bodyRequired?: boolean
  /** Only retained when wildcard response media need declaration-aware decoding. */
  responseContentTypes?: Record<string, string[]>
}

/** Build-time only: strip descriptions, examples, schemas, and unused response metadata. */
export function describeOperations(spec: OpenApiDocument): Map<string, OperationDescriptor> {
  assertDocument(spec)
  const root = record(spec)
  const operations = new Map<string, OperationDescriptor>()
  for (const [path, rawPath] of Object.entries(record(root.paths))) {
    const pathItem = resolveRef(rawPath, spec)
    for (const method of ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace']) {
      if (!Object.hasOwn(pathItem, method)) continue
      const operation = resolveRef(pathItem[method], spec)
      const id =
        typeof operation.operationId === 'string' && operation.operationId
          ? operation.operationId
          : `\0${method} ${path}`
      if (operations.has(id)) throw new Error(`Duplicate operationId: ${id}`)
      const parameters = new Map<string, Parameter>()
      for (const owner of [pathItem, operation]) {
        for (const raw of Array.isArray(owner.parameters) ? owner.parameters : []) {
          const parameter = resolveRef(raw, spec)
          const location = String(parameter.in)
          const style = String(
            parameter.style ?? (['query', 'cookie'].includes(location) ? 'form' : 'simple'),
          )
          if (parameter.allowReserved || parameter.content)
            throw new Error('allowReserved and content-based parameters are not supported')
          if (!['path', 'query', 'header', 'cookie'].includes(location))
            throw new Error(`Unsupported parameter location: ${location}`)
          if (
            (location === 'query' && !['form', 'deepObject'].includes(style)) ||
            (location === 'cookie' && style !== 'form') ||
            (['path', 'header'].includes(location) && style !== 'simple')
          )
            throw new Error(`Unsupported ${location} style: ${style}`)
          if (typeof parameter.name !== 'string') throw new Error('Parameters require a name')
          parameters.set(`${location}:${parameter.name}`, {
            name: parameter.name,
            in: location,
            style,
            required: parameter.required === true || location === 'path',
            explode:
              parameter.explode === undefined ? style === 'form' : parameter.explode === true,
          })
        }
      }
      const servers = operation.servers ?? pathItem.servers ?? root.servers
      const baseUrl = Array.isArray(servers) ? record(servers[0]).url : undefined
      const body = resolveRef(operation.requestBody, spec)
      const content = record(body.content)
      const contentTypes = Object.keys(content)
      const contentType = contentTypes.includes('application/json')
        ? 'application/json'
        : contentTypes.length === 1
          ? contentTypes[0]
          : undefined
      for (const type of contentTypes) {
        if (
          !['application/json', 'multipart/form-data', 'application/octet-stream'].includes(type) &&
          !type.endsWith('+json')
        )
          throw new Error(`${method.toUpperCase()} ${path}: unsupported request media type ${type}`)
      }
      if (operation.requestBody && !contentTypes.length)
        throw new Error(`${method.toUpperCase()} ${path}: empty request content`)
      const multipartJson: string[] = []
      for (const [name, raw] of Object.entries(
        record(record(content['multipart/form-data']).encoding),
      )) {
        const encoding = record(raw)
        if (
          Object.keys(encoding).some((key) => key !== 'contentType') ||
          encoding.contentType !== 'application/json'
        )
          throw new Error(
            `${method.toUpperCase()} ${path}: unsupported multipart encoding for ${name}`,
          )
        multipartJson.push(name)
      }
      const clientPath = operation['x-client-path']
      const responseContentTypes = Object.fromEntries(
        Object.entries(record(operation.responses))
          .filter(([status]) => /^2(?:\d\d|XX)$/.test(status))
          .map(([status, response]) => [
            status,
            Object.keys(record(resolveRef(response, spec).content)),
          ]),
      )
      const wildcardResponse = Object.values(responseContentTypes).some((types) =>
        types.some((type) => type.endsWith('/*')),
      )
      if (
        clientPath !== undefined &&
        (!Array.isArray(clientPath) ||
          !clientPath.length ||
          clientPath.some(
            (part) =>
              typeof part !== 'string' ||
              !part ||
              ['key', 'then', '__proto__', 'prototype', 'constructor'].includes(part),
          ))
      )
        throw new Error(`${method.toUpperCase()} ${path}: invalid x-client-path`)
      operations.set(id, {
        method,
        path,
        ...(clientPath ? { clientPath: clientPath as string[] } : {}),
        ...(parameters.size ? { parameters: [...parameters.values()] } : {}),
        ...(typeof baseUrl === 'string' ? { baseUrl } : {}),
        ...(contentType ? { contentType } : {}),
        ...(contentTypes.length ? { bodyRequired: body.required === true } : {}),
        ...(contentTypes.length > 1 ? { contentTypes } : {}),
        ...(multipartJson.length ? { multipartJson } : {}),
        ...(wildcardResponse ? { responseContentTypes } : {}),
      })
    }
  }
  return operations
}
