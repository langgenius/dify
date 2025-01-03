const STEP_SPLIT = '->'

const toNodeData = (step: string, info: Record<string, any> = {}): any => {
  const [nodeId, title] = step.split('@')
  const data: Record<string, any> = {
    id: nodeId,
    node_id: nodeId,
    title: title || nodeId,
    execution_metadata: {},
    status: 'succeeded',
  }

  const executionMetadata = data.execution_metadata
  const { isRetry, isIteration, inIterationInfo } = info
  if (isRetry)
    data.status = 'retry'

  if (isIteration)
    data.node_type = 'iteration'

  if (inIterationInfo) {
    executionMetadata.iteration_id = inIterationInfo.iterationId
    executionMetadata.iteration_index = inIterationInfo.iterationIndex
  }

  return data
}

const toRetryNodeData = ({
  nodeId,
  repeatTimes,
}: {
  nodeId: string,
  repeatTimes: number,
}): any => {
  const res = [toNodeData(nodeId)]
  for (let i = 0; i < repeatTimes; i++)
    res.push(toNodeData(nodeId, { isRetry: true }))
  return res
}

const toIterationNodeData = ({
  nodeId,
  children,
}: {
  nodeId: string,
  children: number[],
}) => {
  const res = [toNodeData(nodeId, { isIteration: true })]
  // TODO: handle inner node structure
  for (let i = 0; i < children.length; i++)
    res.push(toNodeData(`${children[i]}`, { inIterationInfo: { iterationId: nodeId, iterationIndex: i } }))

  return res
}

type NodeStructure = {
  node: string;
  params: Array<string | NodeStructure>;
}

export function parseNodeString(input: string): NodeStructure {
  input = input.trim()
  if (input.startsWith('(') && input.endsWith(')'))
    input = input.slice(1, -1)

  const parts: Array<string | NodeStructure> = []
  let current = ''
  let depth = 0
  let inArrayDepth = 0

  for (let i = 0; i < input.length; i++) {
    const char = input[i]

    if (char === '(')
      depth++
    else if (char === ')')
      depth--

    if (char === '[')
      inArrayDepth++
    else if (char === ']')
      inArrayDepth--

    const isInArray = inArrayDepth > 0

    if (char === ',' && depth === 0 && !isInArray) {
      parts.push(current.trim())
      current = ''
    }
    else {
      current += char
    }
  }

  if (current)
    parts.push(current.trim())

  const result: NodeStructure = {
    node: '',
    params: [],
  }

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]

    if (typeof part === 'string' && part.startsWith('('))
      result.params.push(parseNodeString(part))
    else if (i === 0)
      result.node = part as string
    else
      result.params.push(part as string)
  }

  return result
}

const toNodes = (input: string): any[] => {
  const list = input.split(STEP_SPLIT)
    .map(step => step.trim())

  const res: any[] = []
  list.forEach((step) => {
    const isPlainStep = !step.includes('(')
    if (isPlainStep) {
      res.push(toNodeData(step))
      return
    }

    const { node, params } = parseNodeString(step)
    switch (node) {
      case 'iteration':
        res.push(...toIterationNodeData({
          nodeId: params[0] as string,
          children: JSON.parse(params[1] as string) as number[],
        }))
        break
      case 'retry':
        res.push(...toRetryNodeData({
          nodeId: params[0] as string,
          repeatTimes: Number.parseInt(params[1] as string),
        }))
        break
    }
  })
  return res
}

/*
* : 1 -> 2 -> 3
* iteration: (iteration, 1, [2, 3]) -> 4.  (1, [2, 3]) means 1 is parent, [2, 3] is children
* parallel: 1 -> (parallel, [1,2,3], [4, (parallel: (6,7))]).
* retry: (retry, 1, 3). 1 is parent, 3 is retry times
*/
const graphToLogStruct = (input: string): any[] => {
  const list = toNodes(input)
  return list
}

export default graphToLogStruct
