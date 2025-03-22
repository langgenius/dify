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

export function isSameQuestionNode(q1: ChatItemInTree, q2: ChatItemInTree): boolean {
  if (q1.content !== q2.content) return false
  if (q1.message_files?.length !== q2.message_files?.length) return false
  q1.message_files?.forEach((file1, index) => {
    const file2 = q2.message_files?.[index]
    if (file1.name !== file2?.name) return false
    if (file1.size !== file2?.size) return false
    if (file1.type !== file2?.type) return false
  })
  return true
}

/**
 * Build a chat item tree from a chat list
 * @param allMessages - The chat list, sorted from oldest to newest
 * @returns The chat item tree
 */
function buildChatItemTree(allMessages: IChatItem[]): ChatItemInTree[] {
  const map: Record<string, ChatItemInTree> = {}
  const rootNodes: ChatItemInTree[] = []

  let lastAppendedLegacyAnswer: ChatItemInTree | null = null
  for (let i = 0; i < allMessages.length; i += 2) {
    const question = allMessages[i]!
    const answer = allMessages[i + 1]!

    const isLegacy = question.parentMessageId === UUID_NIL
    const parentMessageId = isLegacy
      ? (lastAppendedLegacyAnswer?.id || '')
      : (question.parentMessageId || '')

    // Process question
    const questionNode: ChatItemInTree = {
      ...question,
      children: [],
    }
    map[question.id] = questionNode

    // Process answer
    const answerNode: ChatItemInTree = {
      ...answer,
      children: [],
    }
    map[answer.id] = answerNode

    // Connect question and answer
    questionNode.children!.push(answerNode)

    // calculate siblingIndex
    if (isLegacy) {
      questionNode.siblingIndex = 0
      answerNode.siblingIndex = 0
    }
    else {
      const leftSibling = !parentMessageId ? rootNodes.at(-1) : map[parentMessageId]?.children?.at(-1)
      if (!leftSibling) {
        questionNode.siblingIndex = 0
        answerNode.siblingIndex = 0
      }
      else {
        if (isSameQuestionNode(questionNode, leftSibling)) {
          questionNode.siblingIndex = leftSibling.siblingIndex!
          answerNode.siblingIndex = leftSibling.siblingIndex! + 1
        }
        else {
          questionNode.siblingIndex = leftSibling.siblingIndex! + 1
          answerNode.siblingIndex = 0
        }
      }
    }

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

function getPrevOrNextDistinctSiblingQuestion(
  dir: 'prev' | 'next',
  siblings: ChatItemInTree[],
  sourceId: string,
  sourceSiblingIndex: number,
) {
  const siblingCount = siblings.length
  const sourceIndex = siblings.findIndex(item => item.id === sourceId)

  for(
    let i = dir === 'prev' ? sourceIndex - 1 : sourceIndex + 1;
    dir === 'prev' ? i >= 0 : i < siblingCount;
    dir === 'prev' ? i-- : i++
  ) {
    const sibling = siblings[i]
    if (sibling.siblingIndex === sourceSiblingIndex)
      continue
    return sibling
  }
}

// todo
function attachSiblingInfoToItem(tree: ChatItemInTree[], path: ChatItemInTree[], item: ChatItemInTree) {
}

// function bfs<T extends { id: string }>(tree: T[], targetId: string): T | undefined {
//   const queue: T[] = [...tree]
//   while (queue.length > 0) {
//     const node = queue.shift()
//     if (node?.id === targetId)
//       return node
//   }
// }

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
        if (!item.isAnswer) {
          const parentAnswer = path[index - 1]
          const siblings = !parentAnswer ? tree : parentAnswer.children
          const siblingCount = (siblings?.at(-1)?.siblingIndex || 0) + 1
          const prevSibling = getPrevOrNextDistinctSiblingQuestion('prev', siblings || [], item.id, item.siblingIndex!)?.id
          const nextSibling = getPrevOrNextDistinctSiblingQuestion('next', siblings || [], item.id, item.siblingIndex!)?.id

          return { ...item, siblingCount, prevSibling, nextSibling }
        }
        else {
          let prevSibling: string | undefined
          let nextSibling: string | undefined
          let siblingCount = 1

          const question = path[index - 1]
          const parentAnswer = path[index - 2]
          const siblingsOfQuestion = question.parentMessageId ? parentAnswer?.children || [] : tree
          const questionIndex = siblingsOfQuestion.findIndex(item => item.id === question.id)

          for (let i = questionIndex - 1; i >= 0; i--) {
            const sibling = siblingsOfQuestion[i]
            if (sibling.siblingIndex === question.siblingIndex) {
              if (!prevSibling) prevSibling = sibling.children?.[0]?.id
              siblingCount++
            }
            else {
              break
            }
          }

          for (let i = questionIndex + 1; i < siblingsOfQuestion.length; i++) {
            const sibling = siblingsOfQuestion[i]
            if (sibling.siblingIndex === question.siblingIndex) {
              if (!nextSibling) nextSibling = sibling.children?.[0]?.id
              siblingCount++
            }
            else {
              break
            }
          }

          // const siblingCount = !parentAnswer ? tree.length : parentAnswer.children!.length
          // const prevSibling = !parentAnswer
          //   ? tree[item.siblingIndex! - 1]?.children?.[0]?.id
          //   : parentAnswer.children![item.siblingIndex! - 1]?.children?.[0].id
          // const nextSibling = !parentAnswer
          //   ? tree[item.siblingIndex! + 1]?.children?.[0]?.id
          //   : parentAnswer.children![item.siblingIndex! + 1]?.children?.[0].id

          return { ...item, siblingCount, prevSibling, nextSibling }
        }
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
        // if (targetMessageId) debugger

        const lastChild = node.children.at(-1)!

        if (!lastChild.isAnswer) {
          stack.push({
            ...lastChild,
            siblingCount: lastChild.siblingIndex! + 1,
            prevSibling: getPrevOrNextDistinctSiblingQuestion('prev', node.children!, lastChild.id, lastChild.siblingIndex!)?.id,
          })
        }
        else {
          let prevSibling: string | undefined
          let siblingCount = 1

          const question = ret.at(-1)!
          const parentAnswer = ret.at(-2)
          const siblingsOfQuestion = question.parentMessageId ? parentAnswer?.children || [] : tree
          const questionIndex = siblingsOfQuestion.findIndex(item => item.id === question.id)

          for (let i = questionIndex - 1; i >= 0; i--) {
            const sibling = siblingsOfQuestion[i]
            if (sibling.siblingIndex === question.siblingIndex) {
              if (!prevSibling) prevSibling = sibling.children?.[0]?.id
              siblingCount++
            }
            else {
              break
            }
          }

          stack.push({ ...lastChild, siblingCount, prevSibling })
        }
      }
    }
  }

  return ret
}

export {
  getProcessedInputsFromUrlParams,
  isValidGeneratedAnswer,
  getLastAnswer,
  buildChatItemTree,
  getThreadMessages,
}
