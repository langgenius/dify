import { addFileInfos, sortAgentSorts } from '../../tools/utils'
import { UUID_NIL } from './constants'
import type { ChatItem } from './types'
import { getProcessedFilesFromResponse } from '@/app/components/base/file-uploader/utils'

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

function getLastAnswer(chatList: ChatItem[]) {
  for (let i = chatList.length - 1; i >= 0; i--) {
    const item = chatList[i]
    if (item.isAnswer && !item.isOpeningStatement)
      return item
  }
  return null
}

function appendQAToChatList(chatList: ChatItem[], item: any) {
  // we append answer first and then question since will reverse the whole chatList later
  const answerFiles = item.message_files?.filter((file: any) => file.belongs_to === 'assistant') || []
  chatList.push({
    id: item.id,
    content: item.answer,
    agent_thoughts: addFileInfos(item.agent_thoughts ? sortAgentSorts(item.agent_thoughts) : item.agent_thoughts, item.message_files),
    feedback: item.feedback,
    isAnswer: true,
    citation: item.retriever_resources,
    message_files: getProcessedFilesFromResponse(answerFiles.map((item: any) => ({ ...item, related_id: item.id }))),
  })
  const questionFiles = item.message_files?.filter((file: any) => file.belongs_to === 'user') || []
  chatList.push({
    id: `question-${item.id}`,
    content: item.query,
    isAnswer: false,
    message_files: getProcessedFilesFromResponse(questionFiles.map((item: any) => ({ ...item, related_id: item.id }))),
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

export {
  getProcessedInputsFromUrlParams,
  getLastAnswer,
  getPrevChatList,
}
