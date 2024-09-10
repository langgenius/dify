import { addFileInfos, sortAgentSorts } from '../../tools/utils'
import { UUID_NIL } from './constants'
import type { IChatItem } from './chat/type'
import type { ChatItem, ChatItemInTree } from './types'

async function decodeBase64AndDecompress(base64String: string) {
  const binaryString = atob(base64String)
  const compressedUint8Array = Uint8Array.from(binaryString, char => char.charCodeAt(0))
  const decompressedStream = new Response(compressedUint8Array).body?.pipeThrough(new DecompressionStream('gzip'))
  const decompressedArrayBuffer = await new Response(decompressedStream).arrayBuffer()
  return new TextDecoder().decode(decompressedArrayBuffer)
}

function getProcessedInputsFromUrlParams(): Record<string, any> {
  const urlParams = new URLSearchParams(window.location.search)
  const inputs: Record<string, any> = {}
  urlParams.forEach(async (value, key) => {
    inputs[key] = await decodeBase64AndDecompress(decodeURIComponent(value))
  })
  return inputs
}

function appendQAToChatList(chatList: ChatItem[], item: any) {
  // we append answer first and then question since will reverse the whole chatList later
  chatList.push({
    id: item.id,
    content: item.answer,
    agent_thoughts: addFileInfos(item.agent_thoughts ? sortAgentSorts(item.agent_thoughts) : item.agent_thoughts, item.message_files),
    feedback: item.feedback,
    isAnswer: true,
    citation: item.retriever_resources,
    message_files: item.message_files?.filter((file: any) => file.belongs_to === 'assistant') || [],
  })
  chatList.push({
    id: `question-${item.id}`,
    content: item.query,
    isAnswer: false,
    message_files: item.message_files?.filter((file: any) => file.belongs_to === 'user') || [],
  })
}

/**
 * Computes the latest thread messages from all messages of the conversation.
 * Same logic as backend codebase `api/core/prompt/utils/extract_thread_messages.py`
 *
 * @param fetchedMessages - The history chat list data from the backend, sorted by created_at in descending order. This includes all flattened history messages of the conversation.
 * @returns An array of ChatItems representing the latest thread.
 */
function getPrevChatList(fetchedMessages: any[]) {
  const ret: ChatItem[] = []
  let nextMessageId = null

  for (const item of fetchedMessages) {
    if (!item.parent_message_id) {
      appendQAToChatList(ret, item)
      break
    }

    if (!nextMessageId) {
      appendQAToChatList(ret, item)
      nextMessageId = item.parent_message_id
    }
    else {
      if (item.id === nextMessageId || nextMessageId === UUID_NIL) {
        appendQAToChatList(ret, item)
        nextMessageId = item.parent_message_id
      }
    }
  }
  return ret.reverse()
}

function buildChatItemTree(allMessages: IChatItem[]): ChatItemInTree[] {
  const map: Record<string, ChatItemInTree> = {}
  let rootNodes: ChatItemInTree[] = []
  const childrenCount: Record<string, number> = {}

  const legacyQuestions: ChatItemInTree[] = []

  for (let i = 0; i < allMessages.length; i += 2) {
    const question = allMessages[i]!
    const answer = allMessages[i + 1]!

    // Process question
    const parentId = question.parentMessageId ?? ''
    childrenCount[parentId] = (childrenCount[parentId] || 0) + 1
    const questionNode: ChatItemInTree = {
      ...question,
      children: [],
      siblingIndex: childrenCount[parentId] - 1,
    }
    map[question.id] = questionNode

    // Process answer
    childrenCount[question.id] = 1
    const answerNode: ChatItemInTree = {
      ...answer,
      children: [],
      siblingIndex: 0,
    }
    map[answer.id] = answerNode

    // Connect question and answer
    questionNode.children!.push(answerNode)

    // Connect to parent or add to root
    if (!parentId)
      rootNodes.push(questionNode)
    else if (parentId !== UUID_NIL)
      map[parentId]?.children!.push(questionNode)
    else
      legacyQuestions.unshift(questionNode)
  }

  // legacy message compat
  for (const legacyQuestion of legacyQuestions) {
    const answer = legacyQuestion.children![0]!
    const questionNode = map[legacyQuestion.id]
    const answerNode = map[answer.id]
    answerNode.children?.unshift(...rootNodes)
    rootNodes = [questionNode]
  }

  return rootNodes
}

function getThreadMessages(tree: ChatItemInTree[], targetMessageId?: string): ChatItemInTree[] {
  let ret: ChatItemInTree[] = []
  let targetNode: ChatItemInTree | undefined

  // find path to the target message
  const stack = tree.map(rootNode => ({
    node: rootNode,
    path: [rootNode],
  }))
  while (stack.length > 0) {
    const { node, path } = stack.pop()!
    if (node.id === targetMessageId) {
      targetNode = node
      ret = path
      break
    }
    if (node.children) {
      stack.push(...node.children.map(child => ({
        node: child,
        path: [...path, child],
      })))
    }
  }

  // append all descendant messages to the path
  if (targetNode) {
    const stack = [targetNode]
    while (stack.length > 0) {
      const node = stack.pop()!
      if (node !== targetNode)
        ret.push(node)
      if (node.children?.length)
        stack.push(node.children.at(-1)!)
    }
  }
  return ret
}

export {
  getProcessedInputsFromUrlParams,
  getPrevChatList,
  buildChatItemTree,
  getThreadMessages,
}
