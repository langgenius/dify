const operationMethods = new Set(['delete', 'get', 'patch', 'post', 'put'])

const toWords = (value) =>
  value
    .replace(/[{}]/g, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^a-z0-9]+/i)
    .filter(Boolean)

const toPascalCase = (words) =>
  words.map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`).join('')

const toCamelCase = (words) => {
  const pascal = toPascalCase(words)
  return `${pascal.charAt(0).toLowerCase()}${pascal.slice(1)}`
}

const segmentWords = (segment) => {
  if (segment.startsWith('{') && segment.endsWith('}')) return ['by', ...toWords(segment)]
  return toWords(segment)
}

const routeWords = (routePath) => routePath.split(/[/:]/).filter(Boolean).flatMap(segmentWords)

export const generatedOperationId = (method, routePath) =>
  toCamelCase([method, ...(routeWords(routePath).length > 0 ? routeWords(routePath) : ['root'])])

export const topLevelPathSegment = (routePath) => routePath.split('/').filter(Boolean)[0] ?? 'root'

export const toKebabCase = (value) => toWords(value).join('-').toLowerCase()

const isSuccessStatus = (status) => status === '2XX' || /^2\d\d$/.test(status)

export function getTypedEventStreamOperations(document) {
  const operations = []

  for (const [routePath, pathItem] of Object.entries(document.paths ?? {})) {
    if (typeof pathItem !== 'object' || pathItem === null) continue

    for (const [method, operation] of Object.entries(pathItem)) {
      if (
        !operationMethods.has(method) ||
        typeof operation !== 'object' ||
        operation === null ||
        typeof operation['x-dify-typed-event-stream-response'] !== 'string'
      ) {
        continue
      }

      const successMediaTypes = Object.entries(operation.responses ?? {}).flatMap(
        ([status, response]) => {
          if (
            !isSuccessStatus(status) ||
            typeof response !== 'object' ||
            response === null ||
            typeof response.content !== 'object' ||
            response.content === null
          ) {
            return []
          }
          return Object.keys(response.content)
        },
      )
      if (
        successMediaTypes.length === 0 ||
        successMediaTypes.some((mediaType) => mediaType !== 'text/event-stream')
      ) {
        continue
      }

      operations.push({
        method,
        operationId: generatedOperationId(method, routePath),
        path: routePath,
      })
    }
  }

  return operations.sort((left, right) => left.operationId.localeCompare(right.operationId))
}
