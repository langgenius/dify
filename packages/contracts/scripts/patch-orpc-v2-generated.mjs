import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const targets = process.argv.slice(2)
const currentDir = path.dirname(fileURLToPath(import.meta.url))
const openApiDir = path.resolve(currentDir, '../openapi')
const operationMethods = new Set(['delete', 'get', 'patch', 'post', 'put'])

if (!targets.length)
  throw new Error('Usage: node scripts/patch-orpc-v2-generated.mjs <file-or-directory> [...]')

const isObject = value => !!value && typeof value === 'object' && !Array.isArray(value)

const toWords = (value) => {
  return value
    .replace(/[{}]/g, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^a-z0-9]+/i)
    .filter(Boolean)
}

const toPascalCase = words => words.map(word => `${word.charAt(0).toUpperCase()}${word.slice(1)}`).join('')

const toCamelCase = (words) => {
  const pascal = toPascalCase(words)
  return `${pascal.charAt(0).toLowerCase()}${pascal.slice(1)}`
}

const segmentWords = (segment) => {
  if (segment.startsWith('{') && segment.endsWith('}'))
    return ['by', ...toWords(segment)]

  return toWords(segment)
}

const routeWords = (routePath) => {
  return routePath
    .split('/')
    .filter(Boolean)
    .flatMap(segmentWords)
}

const operationId = (method, routePath) => {
  return toCamelCase([method, ...(routeWords(routePath).length > 0 ? routeWords(routePath) : ['root'])])
}

const getSchemaType = (schema) => {
  if (!isObject(schema))
    return undefined

  if (Array.isArray(schema.type))
    return schema.type

  return typeof schema.type === 'string' ? [schema.type] : undefined
}

const getQueryArrayStyle = (parameter) => {
  if (!isObject(parameter) || parameter.in !== 'query' || typeof parameter.name !== 'string')
    return undefined

  const schemaTypes = getSchemaType(parameter.schema)
  if (!schemaTypes?.includes('array'))
    return undefined

  const style = typeof parameter.style === 'string' ? parameter.style : 'form'
  const explode = typeof parameter.explode === 'boolean' ? parameter.explode : style === 'form'

  if (style === 'form')
    return explode ? 'array' : 'comma-delimited-array'
  if (style === 'spaceDelimited')
    return 'space-delimited-array'
  if (style === 'pipeDelimited')
    return 'pipe-delimited-array'

  return undefined
}

const readQueryStylesByOperationId = () => {
  const stylesByOperationId = new Map()

  if (!fs.existsSync(openApiDir))
    return stylesByOperationId

  for (const filename of fs.readdirSync(openApiDir)) {
    if (!filename.endsWith('-openapi.json'))
      continue

    const document = JSON.parse(fs.readFileSync(path.join(openApiDir, filename), 'utf8'))
    if (!isObject(document.paths))
      continue

    for (const [routePath, pathItem] of Object.entries(document.paths)) {
      if (!isObject(pathItem))
        continue

      for (const [method, operation] of Object.entries(pathItem)) {
        if (!operationMethods.has(method) || !isObject(operation) || !Array.isArray(operation.parameters))
          continue

        const queryStyles = {}
        for (const parameter of operation.parameters) {
          const style = getQueryArrayStyle(parameter)
          if (style)
            queryStyles[parameter.name] = style
        }

        if (Object.keys(queryStyles).length > 0)
          stylesByOperationId.set(operationId(method, routePath), queryStyles)
      }
    }
  }

  return stylesByOperationId
}

const queryStylesByOperationId = readQueryStylesByOperationId()

function* tsFiles(target) {
  if (!fs.existsSync(target))
    return

  const stat = fs.statSync(target)
  if (stat.isFile()) {
    if (target.endsWith('.ts'))
      yield target
    return
  }

  if (!stat.isDirectory())
    return

  for (const entry of fs.readdirSync(target)) {
    yield* tsFiles(path.join(target, entry))
  }
}

const propertyKey = (key) => {
  if (/^[A-Z_$][\w$]*$/i.test(key))
    return key

  return `'${key.replace(/\\/g, '\\\\').replace(/'/g, '\\\'')}'`
}

const queryStylesProperty = (queryStyles, indent) => {
  const entries = Object.entries(queryStyles)
    .map(([key, style]) => `${indent}  ${propertyKey(key)}: '${style}',`)
    .join('\n')

  return `${indent}queryStyles: {\n${entries}\n${indent}},\n`
}

const patchOpenAPIBody = (body) => {
  if (body.includes('queryStyles:'))
    return body

  const operationIdMatch = body.match(/\n\s*operationId:\s*'([^']+)',/)
  if (!operationIdMatch)
    return body

  const queryStyles = queryStylesByOperationId.get(operationIdMatch[1])
  if (!queryStyles)
    return body

  const pathLineMatch = body.match(/\n(\s*)path:\s*'[^']+',\n/)
  if (pathLineMatch) {
    return body.replace(
      pathLineMatch[0],
      `${pathLineMatch[0]}${queryStylesProperty(queryStyles, pathLineMatch[1])}`,
    )
  }

  const tagsLineMatch = body.match(/\n(\s*)tags:\s*\[[^\n]+,\n/)
  if (tagsLineMatch) {
    return body.replace(
      tagsLineMatch[0],
      `${queryStylesProperty(queryStyles, tagsLineMatch[1])}${tagsLineMatch[0]}`,
    )
  }

  return body
}

const findMatchingBrace = (source, startIndex) => {
  let depth = 0
  let quote
  let escaped = false

  for (let index = startIndex; index < source.length; index++) {
    const char = source[index]

    if (quote) {
      if (escaped) {
        escaped = false
        continue
      }

      if (char === '\\') {
        escaped = true
        continue
      }

      if (char === quote)
        quote = undefined

      continue
    }

    if (char === '\'' || char === '"' || char === '`') {
      quote = char
      continue
    }

    if (char === '{') {
      depth += 1
      continue
    }

    if (char === '}') {
      depth -= 1
      if (depth === 0)
        return index
    }
  }

  return -1
}

const patchOpenAPIObjects = (source) => {
  const token = 'openapi({'
  let output = ''
  let cursor = 0

  while (true) {
    const tokenIndex = source.indexOf(token, cursor)
    if (tokenIndex === -1)
      return `${output}${source.slice(cursor)}`

    const bodyStart = tokenIndex + token.length
    const braceEnd = findMatchingBrace(source, bodyStart - 1)
    if (braceEnd === -1)
      return `${output}${source.slice(cursor)}`

    output += source.slice(cursor, bodyStart)
    output += patchOpenAPIBody(source.slice(bodyStart, braceEnd))
    output += '}'
    cursor = braceEnd + 1
  }
}

for (const target of targets) {
  for (const filePath of tsFiles(target)) {
    const source = fs.readFileSync(filePath, 'utf8')
    if (!source.includes('.route(') && !source.includes('.$route(') && !source.includes('openapi('))
      continue

    let output = source
      .replace(/\.\$?route\((\{[\s\S]*?\})\)/g, '.meta(openapi($1))')
    output = patchOpenAPIObjects(output)

    if (output.includes('openapi(') && !output.includes('from \'@orpc/openapi\'')) {
      output = output.replace(
        /(import\s+\{[^}]*\boc\b[^}]*\}\s+from '@orpc\/contract';?\n)/,
        '$1import { openapi } from \'@orpc/openapi\'\n',
      )
    }

    if (output !== source)
      fs.writeFileSync(filePath, output)
  }
}
