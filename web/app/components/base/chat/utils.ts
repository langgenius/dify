import { UUID_NIL } from './constants'
import type { IChatItem } from './chat/type'
import type { ChatItem, ChatItemInTree } from './types'

async function decodeBase64AndDecompress(base64String: string) {
  try {
    const binaryString = atob(base64String)
    const compressedUint8Array = Uint8Array.from(binaryString, char => char.charCodeAt(0))
    const decompressedStream = new Response(compressedUint8Array).body?.pipeThrough(new DecompressionStream('gzip'))
    const decompressedArrayBuffer = await new Response(decompressedStream).arrayBuffer()
    return new TextDecoder().decode(decompressedArrayBuffer)
  }
  catch {
    return undefined
  }
}

async function getRawInputsFromUrlParams(): Promise<Record<string, any>> {
  const urlParams = new URLSearchParams(window.location.search)
  const inputs: Record<string, any> = {}
  const entriesArray = Array.from(urlParams.entries())
  entriesArray.forEach(([key, value]) => {
    const prefixArray = ['sys.', 'user.']
    if (!prefixArray.some(prefix => key.startsWith(prefix)))
      inputs[key] = decodeURIComponent(value)
  })
  return inputs
}

async function getProcessedInputsFromUrlParams(): Promise<Record<string, any>> {
  const urlParams = new URLSearchParams(window.location.search)
  const inputs: Record<string, any> = {}
  const entriesArray = Array.from(urlParams.entries())
  await Promise.all(
    entriesArray.map(async ([key, value]) => {
      const prefixArray = ['sys.', 'user.']
      if (!prefixArray.some(prefix => key.startsWith(prefix)))
        inputs[key] = await decodeBase64AndDecompress(decodeURIComponent(value))
    }),
  )
  return inputs
}

async function getProcessedSystemVariablesFromUrlParams(): Promise<Record<string, any>> {
  const urlParams = new URLSearchParams(window.location.search)
  const redirectUrl = urlParams.get('redirect_url')
  if (redirectUrl) {
    const decodedRedirectUrl = decodeURIComponent(redirectUrl)
    const queryString = decodedRedirectUrl.split('?')[1]
    if (queryString) {
      const redirectParams = new URLSearchParams(queryString)
      for (const [key, value] of redirectParams.entries())
        urlParams.set(key, value)
    }
  }
  const systemVariables: Record<string, any> = {}
  const entriesArray = Array.from(urlParams.entries())
  await Promise.all(
    entriesArray.map(async ([key, value]) => {
      if (key.startsWith('sys.'))
        systemVariables[key.slice(4)] = await decodeBase64AndDecompress(decodeURIComponent(value))
    }),
  )
  return systemVariables
}

async function getProcessedUserVariablesFromUrlParams(): Promise<Record<string, any>> {
  const urlParams = new URLSearchParams(window.location.search)
  const userVariables: Record<string, any> = {}
  const entriesArray = Array.from(urlParams.entries())
  await Promise.all(
    entriesArray.map(async ([key, value]) => {
      if (key.startsWith('user.'))
        userVariables[key.slice(5)] = await decodeBase64AndDecompress(decodeURIComponent(value))
    }),
  )
  return userVariables
}

async function getRawUserVariablesFromUrlParams(): Promise<Record<string, any>> {
  const urlParams = new URLSearchParams(window.location.search)
  const userVariables: Record<string, any> = {}
  const entriesArray = Array.from(urlParams.entries())
  entriesArray.forEach(([key, value]) => {
    if (key.startsWith('user.'))
      userVariables[key.slice(5)] = decodeURIComponent(value)
  })
  return userVariables
}

function isValidGeneratedAnswer(item?: ChatItem | ChatItemInTree): boolean {
  return !!item && item.isAnswer && !item.id.startsWith('answer-placeholder-') && !item.isOpeningStatement
}

function getLastAnswer<T extends ChatItem | ChatItemInTree>(chatList: T[]): T | null {
  for (let i = chatList.length - 1; i >= 0; i--) {
    const item = chatList[i]
    if (isValidGeneratedAnswer(item))
      return item
  }
  return null
}

/**
 * Build a chat item tree from a chat list
 * @param allMessages - The chat list, sorted from oldest to newest
 * @returns The chat item tree
 */
function buildChatItemTree(allMessages: IChatItem[]): ChatItemInTree[] {
  const map: Record<string, ChatItemInTree> = {}
  const rootNodes: ChatItemInTree[] = []
  const childrenCount: Record<string, number> = {}

  let lastAppendedLegacyAnswer: ChatItemInTree | null = null
  for (let i = 0; i < allMessages.length; i += 2) {
    const question = allMessages[i]!
    const answer = allMessages[i + 1]!

    const isLegacy = question.parentMessageId === UUID_NIL
    const parentMessageId = isLegacy
      ? (lastAppendedLegacyAnswer?.id || '')
      : (question.parentMessageId || '')

    // Process question
    childrenCount[parentMessageId] = (childrenCount[parentMessageId] || 0) + 1
    const questionNode: ChatItemInTree = {
      ...question,
      children: [],
    }
    map[question.id] = questionNode

    // Process answer
    childrenCount[question.id] = 1
    const answerNode: ChatItemInTree = {
      ...answer,
      children: [],
      siblingIndex: isLegacy ? 0 : childrenCount[parentMessageId] - 1,
    }
    map[answer.id] = answerNode

    // Connect question and answer
    questionNode.children!.push(answerNode)

    // Append to parent or add to root
    if (isLegacy) {
      if (!lastAppendedLegacyAnswer)
        rootNodes.push(questionNode)
      else
        lastAppendedLegacyAnswer.children!.push(questionNode)

      lastAppendedLegacyAnswer = answerNode
    }
    else {
      if (
        !parentMessageId
        || !allMessages.some(item => item.id === parentMessageId) // parent message might not be fetched yet, in this case we will append the question to the root nodes
      )
        rootNodes.push(questionNode)
      else
        map[parentMessageId]?.children!.push(questionNode)
    }
  }

  return rootNodes
}

function getThreadMessages(tree: ChatItemInTree[], targetMessageId?: string): ChatItemInTree[] {
  let ret: ChatItemInTree[] = []
  let targetNode: ChatItemInTree | undefined

  // find path to the target message
  const stack = tree.slice().reverse().map(rootNode => ({
    node: rootNode,
    path: [rootNode],
  }))
  while (stack.length > 0) {
    const { node, path } = stack.pop()!
    if (
      node.id === targetMessageId
      || (!targetMessageId && !node.children?.length && !stack.length) // if targetMessageId is not provided, we use the last message in the tree as the target
    ) {
      targetNode = node
      ret = path.map((item, index) => {
        if (!item.isAnswer)
          return item

        const parentAnswer = path[index - 2]
        const siblingCount = !parentAnswer ? tree.length : parentAnswer.children!.length
        const prevSibling = !parentAnswer ? tree[item.siblingIndex! - 1]?.children?.[0]?.id : parentAnswer.children![item.siblingIndex! - 1]?.children?.[0].id
        const nextSibling = !parentAnswer ? tree[item.siblingIndex! + 1]?.children?.[0]?.id : parentAnswer.children![item.siblingIndex! + 1]?.children?.[0].id

        return { ...item, siblingCount, prevSibling, nextSibling }
      })
      break
    }
    if (node.children) {
      for (let i = node.children.length - 1; i >= 0; i--) {
        stack.push({
          node: node.children[i],
          path: [...path, node.children[i]],
        })
      }
    }
  }

  // append all descendant messages to the path
  if (targetNode) {
    const stack = [targetNode]
    while (stack.length > 0) {
      const node = stack.pop()!
      if (node !== targetNode)
        ret.push(node)
      if (node.children?.length) {
        const lastChild = node.children.at(-1)!

        if (!lastChild.isAnswer) {
          stack.push(lastChild)
          continue
        }

        const parentAnswer = ret.at(-2)
        const siblingCount = parentAnswer?.children?.length
        const prevSibling = parentAnswer?.children?.at(-2)?.children?.[0]?.id

        stack.push({ ...lastChild, siblingCount, prevSibling })
      }
    }
  }

  return ret
}

export {
  getRawInputsFromUrlParams,
  getProcessedInputsFromUrlParams,
  getProcessedSystemVariablesFromUrlParams,
  getProcessedUserVariablesFromUrlParams,
  getRawUserVariablesFromUrlParams,
  isValidGeneratedAnswer,
  getLastAnswer,
  buildChatItemTree,
  getThreadMessages,
}
