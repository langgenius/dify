/* eslint-disable ts/no-explicit-any */
import type { IChatItem } from '@/app/components/base/chat/chat/type'
import {
  applyAnnotationAdded,
  applyAnnotationEdited,
  applyAnnotationRemoved,
  buildChatThreadState,
  buildConversationUrl,
  getCompletionMessageFiles,
  getConversationRowValues,
  getDetailVarList,
  getFormattedChatList,
  getThreadChatItems,
  hasConversationFeedback,
  isNearTopLoadMore,
  mergePaginatedChatItems,
  mergeUniqueChatItems,
} from '../list-utils'

const createChatItems = (): IChatItem[] => ([
  { id: 'question-1', content: 'hello', isAnswer: false },
  { id: 'answer-1', content: 'world', isAnswer: true, parentMessageId: 'question-1' },
  { id: 'question-2', content: 'next', isAnswer: false, parentMessageId: 'answer-1' },
  { id: 'answer-2', content: 'reply', isAnswer: true, parentMessageId: 'question-2' },
]) as IChatItem[]

describe('log list utils', () => {
  it('should format chat messages into paired question and answer items', () => {
    const items = getFormattedChatList([
      {
        id: 'message-1',
        inputs: { query: 'hello' },
        query: 'hello',
        answer: 'world',
        created_at: 1710000000,
        answer_tokens: 3,
        message_tokens: 2,
        message: [{ role: 'user', text: 'hello' }],
        message_files: [
          { belongs_to: 'assistant', id: 'file-1' },
          { belongs_to: 'user', id: 'file-2' },
        ],
      },
    ] as any, 'conversation-1', 'UTC', 'YYYY-MM-DD')

    expect(items).toHaveLength(2)
    expect(items[0]).toEqual(expect.objectContaining({
      id: 'question-message-1',
      content: 'hello',
      isAnswer: false,
    }))
    expect(items[1]).toEqual(expect.objectContaining({
      id: 'message-1',
      content: 'world',
      isAnswer: true,
      conversationId: 'conversation-1',
    }))
  })

  it('should preserve feedback and annotation hit history when formatting chat items', () => {
    const items = getFormattedChatList([
      {
        id: 'message-2',
        inputs: { default_input: 'fallback prompt' },
        query: '',
        answer: 'answer',
        created_at: 1710000000,
        answer_tokens: 1,
        message_tokens: 1,
        message: [{ role: 'assistant', text: 'answer' }],
        feedbacks: [
          { from_source: 'user', rating: 'like' },
          { from_source: 'admin', rating: 'dislike' },
        ],
        annotation_hit_history: {
          annotation_id: 'annotation-1',
          annotation_create_account: {},
          created_at: 123,
        },
      },
    ] as any, 'conversation-2', 'UTC', 'YYYY-MM-DD')

    expect(items[1]).toEqual(expect.objectContaining({
      feedback: expect.objectContaining({ rating: 'like' }),
      adminFeedback: expect.objectContaining({ rating: 'dislike' }),
      annotation: expect.objectContaining({
        id: 'annotation-1',
        authorName: 'N/A',
        created_at: 123,
      }),
    }))
  })

  it('should merge unique chat items and handle pagination retries', () => {
    const prevItems = createChatItems()
    const merged = mergeUniqueChatItems(prevItems, [
      { id: 'answer-2', content: 'reply', isAnswer: true } as IChatItem,
      { id: 'answer-3', content: 'final', isAnswer: true } as IChatItem,
    ])

    expect(merged.map(item => item.id)).toEqual(['answer-3', 'question-1', 'answer-1', 'question-2', 'answer-2'])

    expect(mergePaginatedChatItems({
      maxRetryCount: 3,
      newItems: [],
      prevItems,
      retryCount: 1,
    })).toEqual({
      items: prevItems,
      retryCount: 2,
    })

    expect(mergePaginatedChatItems({
      maxRetryCount: 3,
      newItems: [],
      prevItems,
      retryCount: 3,
    })).toEqual({
      items: prevItems,
      retryCount: 0,
    })
  })

  it('should build thread state and support switching siblings', () => {
    const state = buildChatThreadState({
      allChatItems: createChatItems(),
      hasMore: false,
      introduction: 'intro',
    })

    expect(state.chatItemTree[0]).toEqual(expect.objectContaining({
      id: 'introduction',
      isOpeningStatement: true,
    }))
    expect(state.oldestAnswerId).toBe('answer-1')
    expect(getThreadChatItems(state.chatItemTree, 'answer-2').at(-1)?.id).toBe('answer-2')
  })

  it('should return an empty thread state when there are no chat items', () => {
    expect(buildChatThreadState({
      allChatItems: [],
      hasMore: true,
    })).toEqual({
      chatItemTree: [],
      oldestAnswerId: undefined,
      threadChatItems: [],
    })
  })

  it('should update annotation state helpers', () => {
    const items = createChatItems()

    expect(applyAnnotationEdited(items, 'updated question', 'updated answer', 1)[0]!.content).toBe('updated question')
    expect(applyAnnotationAdded(items, 'annotation-1', 'Dify', 'question', 'answer', 1)[1]!.annotation).toEqual(expect.objectContaining({
      id: 'annotation-1',
      authorName: 'Dify',
    }))
    expect(applyAnnotationRemoved(items, 1)[1]!.annotation).toBeUndefined()
  })

  it('should derive urls, scroll thresholds, row values, and detail metadata', () => {
    expect(buildConversationUrl('/apps/app-1/logs', 'page=2', 'conversation-1')).toBe('/apps/app-1/logs?page=2&conversation_id=conversation-1')
    expect(isNearTopLoadMore({
      clientHeight: 200,
      scrollHeight: 600,
      scrollTop: -380,
    })).toBe(true)

    expect(getConversationRowValues({
      isChatMode: false,
      log: {
        from_account_name: 'demo-user',
        message: {
          inputs: { query: 'hello' },
          answer: 'world',
        },
      },
      noChatLabel: 'no chat',
      noOutputLabel: 'no output',
    })).toEqual({
      endUser: 'demo-user',
      isLeftEmpty: false,
      isRightEmpty: false,
      leftValue: 'hello',
      rightValue: 'world',
    })

    expect(getDetailVarList({
      model_config: {
        user_input_form: [
          {
            text_input: {
              variable: 'query',
            },
          },
        ],
      },
      message: {
        inputs: { query: 'fallback value' },
      },
    }, {})).toEqual([
      {
        label: 'query',
        value: 'fallback value',
      },
    ])

    expect(getCompletionMessageFiles({
      message: {
        message_files: [{ url: 'https://example.com/file-1' }],
      },
    }, false)).toEqual(['https://example.com/file-1'])
  })

  it('should remove conversation ids from urls, handle default inputs, and detect conversation feedback', () => {
    expect(buildConversationUrl('/apps/app-1/logs', 'page=2&conversation_id=conversation-1')).toBe('/apps/app-1/logs?page=2')

    expect(getConversationRowValues({
      isChatMode: false,
      log: {
        from_end_user_session_id: 'session-1',
        message: {
          inputs: { default_input: 'fallback input' },
          answer: 0,
        },
      },
      noChatLabel: 'no chat',
      noOutputLabel: 'no output',
    })).toEqual({
      endUser: 'session-1',
      isLeftEmpty: false,
      isRightEmpty: true,
      leftValue: 'fallback input',
      rightValue: 0,
    })

    expect(hasConversationFeedback({ like: 0, dislike: 0 })).toBe(false)
    expect(hasConversationFeedback({ like: 1, dislike: 0 })).toBe(true)
  })
})
