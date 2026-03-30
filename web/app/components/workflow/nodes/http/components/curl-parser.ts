import type { HttpNodeType } from '../types'
import { BodyPayloadValueType, BodyType, Method } from '../types'

const METHOD_ARG_FLAGS = new Set(['-X', '--request'])
const HEADER_ARG_FLAGS = new Set(['-H', '--header'])
const DATA_ARG_FLAGS = new Set(['-d', '--data', '--data-raw', '--data-binary'])
const FORM_ARG_FLAGS = new Set(['-F', '--form'])

type ParseStepResult = {
  error: string | null
  nextIndex: number
  hasData?: boolean
}

const stripWrappedQuotes = (value: string) => {
  return value.replace(/^['"]|['"]$/g, '')
}

const parseCurlArgs = (curlCommand: string) => {
  return curlCommand.match(/(?:[^\s"']|"[^"]*"|'[^']*')+/g) || []
}

const buildDefaultNode = (): Partial<HttpNodeType> => ({
  title: 'HTTP Request',
  desc: 'Imported from cURL',
  method: undefined,
  url: '',
  headers: '',
  params: '',
  body: { type: BodyType.none, data: '' },
})

const extractUrlParams = (url: string) => {
  const urlParts = url.split('?')
  if (urlParts.length <= 1)
    return { url, params: '' }

  return {
    url: urlParts[0],
    params: urlParts[1].replace(/&/g, '\n').replace(/=/g, ': '),
  }
}

const getNextArg = (args: string[], index: number, error: string): { value: string, error: null } | { value: null, error: string } => {
  if (index + 1 >= args.length)
    return { value: null, error }

  return {
    value: stripWrappedQuotes(args[index + 1]),
    error: null,
  }
}

const applyMethodArg = (node: Partial<HttpNodeType>, args: string[], index: number): ParseStepResult => {
  const nextArg = getNextArg(args, index, 'Missing HTTP method after -X or --request.')
  if (nextArg.error || nextArg.value === null)
    return { error: nextArg.error, nextIndex: index, hasData: false }

  node.method = (nextArg.value.toLowerCase() as Method) || Method.get
  return { error: null, nextIndex: index + 1, hasData: true }
}

const applyHeaderArg = (node: Partial<HttpNodeType>, args: string[], index: number): ParseStepResult => {
  const nextArg = getNextArg(args, index, 'Missing header value after -H or --header.')
  if (nextArg.error || nextArg.value === null)
    return { error: nextArg.error, nextIndex: index }

  node.headers += `${node.headers ? '\n' : ''}${nextArg.value}`
  return { error: null, nextIndex: index + 1 }
}

const applyDataArg = (node: Partial<HttpNodeType>, args: string[], index: number): ParseStepResult => {
  const nextArg = getNextArg(args, index, 'Missing data value after -d, --data, --data-raw, or --data-binary.')
  if (nextArg.error || nextArg.value === null)
    return { error: nextArg.error, nextIndex: index }

  node.body = {
    type: BodyType.rawText,
    data: [{ type: BodyPayloadValueType.text, value: nextArg.value }],
  }
  return { error: null, nextIndex: index + 1 }
}

const applyFormArg = (node: Partial<HttpNodeType>, args: string[], index: number): ParseStepResult => {
  const nextArg = getNextArg(args, index, 'Missing form data after -F or --form.')
  if (nextArg.error || nextArg.value === null)
    return { error: nextArg.error, nextIndex: index }

  if (node.body?.type !== BodyType.formData)
    node.body = { type: BodyType.formData, data: '' }

  const [key, ...valueParts] = nextArg.value.split('=')
  if (!key)
    return { error: 'Invalid form data format.', nextIndex: index }

  let value = valueParts.join('=')
  const typeMatch = /^(.+?);type=(.+)$/.exec(value)
  if (typeMatch) {
    const [, actualValue, mimeType] = typeMatch
    value = actualValue
    node.headers += `${node.headers ? '\n' : ''}Content-Type: ${mimeType}`
  }

  node.body.data += `${node.body.data ? '\n' : ''}${key}:${value}`
  return { error: null, nextIndex: index + 1 }
}

const applyJsonArg = (node: Partial<HttpNodeType>, args: string[], index: number): ParseStepResult => {
  const nextArg = getNextArg(args, index, 'Missing JSON data after --json.')
  if (nextArg.error || nextArg.value === null)
    return { error: nextArg.error, nextIndex: index }

  node.body = { type: BodyType.json, data: nextArg.value }
  return { error: null, nextIndex: index + 1 }
}

const handleCurlArg = (
  arg: string,
  node: Partial<HttpNodeType>,
  args: string[],
  index: number,
): ParseStepResult => {
  if (METHOD_ARG_FLAGS.has(arg))
    return applyMethodArg(node, args, index)

  if (HEADER_ARG_FLAGS.has(arg))
    return applyHeaderArg(node, args, index)

  if (DATA_ARG_FLAGS.has(arg))
    return applyDataArg(node, args, index)

  if (FORM_ARG_FLAGS.has(arg))
    return applyFormArg(node, args, index)

  if (arg === '--json')
    return applyJsonArg(node, args, index)

  if (arg.startsWith('http') && !node.url)
    node.url = arg

  return { error: null, nextIndex: index, hasData: false }
}

export const parseCurl = (curlCommand: string): { node: HttpNodeType | null, error: string | null } => {
  if (!curlCommand.trim().toLowerCase().startsWith('curl'))
    return { node: null, error: 'Invalid cURL command. Command must start with "curl".' }

  const node = buildDefaultNode()
  const args = parseCurlArgs(curlCommand)
  let hasData = false

  for (let i = 1; i < args.length; i++) {
    const result = handleCurlArg(stripWrappedQuotes(args[i]), node, args, i)
    if (result.error)
      return { node: null, error: result.error }

    hasData ||= Boolean(result.hasData)
    i = result.nextIndex
  }

  node.method = node.method || (hasData ? Method.post : Method.get)

  if (!node.url)
    return { node: null, error: 'Missing URL or url not start with http.' }

  const parsedUrl = extractUrlParams(node.url)
  node.url = parsedUrl.url
  node.params = parsedUrl.params

  return { node: node as HttpNodeType, error: null }
}
