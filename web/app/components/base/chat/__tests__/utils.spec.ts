import type { IChatItem } from '../chat/type'
import type { ChatItem, ChatItemInTree } from '../types'
import { gzipSync } from 'node:zlib'
import {
  buildChatItemTree,
  getLastAnswer,
  getProcessedInputsFromUrlParams,
  getProcessedSystemVariablesFromUrlParams,
  getProcessedUserVariablesFromUrlParams,
  getRawInputsFromUrlParams,
  getRawUserVariablesFromUrlParams,
  getThreadMessages,
  isValidGeneratedAnswer,
} from '../utils'
import branchedTestMessages from './branchedTestMessages.json'
import legacyTestMessages from './legacyTestMessages.json'
import mixedTestMessages from './mixedTestMessages.json'
import multiRootNodesMessages from './multiRootNodesMessages.json'
import multiRootNodesWithLegacyTestMessages from './multiRootNodesWithLegacyTestMessages.json'
import partialMessages from './partialMessages.json'
import realWorldMessages from './realWorldMessages.json'

const ids = (messages: ChatItemInTree[]) => messages.map((message) => message.id)

describe('chat histories', () => {
  it.each([
    ['branched', branchedTestMessages, ['question-1', '1', 'question-4', '4']],
    [
      'legacy',
      legacyTestMessages,
      ['question-1', '1', 'question-2', '2', 'question-3', '3', 'question-4', '4'],
    ],
    ['mixed', mixedTestMessages, ['question-1', '1', 'question-4', '4']],
    ['multiple roots', multiRootNodesMessages, ['question-5', '5']],
    ['legacy and multiple roots', multiRootNodesWithLegacyTestMessages, ['question-5', '5']],
  ])('selects the latest thread from %s history', (_name, messages, expected) => {
    const tree = buildChatItemTree(messages as ChatItemInTree[])
    expect(ids(getThreadMessages(tree))).toEqual(expected)
  })

  it('selects an earlier branch with navigation to its sibling', () => {
    const tree = buildChatItemTree(branchedTestMessages as ChatItemInTree[])
    const thread = getThreadMessages(tree, '3')
    expect(ids(thread)).toEqual(['question-1', '1', 'question-2', '2', 'question-3', '3'])
    expect(thread[3]).toMatchObject({ siblingIndex: 0, siblingCount: 2, nextSibling: '4' })
    expect(getThreadMessages(tree)[3]).toMatchObject({
      siblingIndex: 1,
      siblingCount: 2,
      prevSibling: '2',
    })
  })

  it('keeps independent conversations and chooses descendants of the requested answer', () => {
    const tree = buildChatItemTree(realWorldMessages as ChatItemInTree[])
    expect(ids(tree)).toEqual([
      'question-ff4c2b43-48a5-47ad-9dc5-08b34ddba61b',
      'question-cd5affb0-7bc2-4a6f-be7e-25e74595c9dd',
    ])
    expect(
      getThreadMessages(tree)
        .filter((item) => item.isAnswer)
        .map((item) => item.id),
    ).toEqual([
      'cd5affb0-7bc2-4a6f-be7e-25e74595c9dd',
      '684b5396-4e91-4043-88e9-aabe48b21acc',
      '19904a7b-7494-4ed8-b72c-1d18668cea8c',
    ])
    expect(
      getThreadMessages(tree, 'ff4c2b43-48a5-47ad-9dc5-08b34ddba61b')
        .filter((item) => item.isAnswer)
        .map((item) => item.id),
    ).toEqual([
      'ff4c2b43-48a5-47ad-9dc5-08b34ddba61b',
      '73bbad14-d915-499d-87bf-0df14d40779d',
      '4c5d0841-1206-463e-95d8-71f812877658',
    ])
  })

  it('promotes messages whose parent was not fetched while retaining their descendants', () => {
    const tree = buildChatItemTree(partialMessages as ChatItemInTree[])
    expect(ids(tree)).toEqual([
      'question-ebb73fe2-15de-46dd-aab5-75416d8448eb',
      'question-3553d508-3850-462e-8594-078539f940f9',
      'question-507f9df9-1f06-4a57-bb38-f00228c42c22',
    ])
    const thread = getThreadMessages(tree)
    expect(ids(thread)).toEqual(partialMessages.slice(4).map((message) => message.id))
    expect(thread[1]).toMatchObject({
      siblingCount: 3,
      siblingIndex: 2,
      prevSibling: '3553d508-3850-462e-8594-078539f940f9',
    })
  })
})

describe('chat utils - url params and answer helpers', () => {
  const setSearch = (search: string) => {
    window.history.replaceState({}, '', `${window.location.pathname}${search}`)
  }
  beforeEach(() => setSearch(''))
  afterEach(() => setSearch(''))

  describe('URL Parameter Extractors', () => {
    const compressed = (value: string) => gzipSync(value).toString('base64')

    it('keeps raw inputs and user variables separate and decodes URL encoding once', async () => {
      setSearch(
        `?${new URLSearchParams({
          custom: '100% + / %2F',
          'sys.param': 'system',
          'user.name': '用户 %20',
        })}`,
      )
      expect(await getRawInputsFromUrlParams()).toEqual({ custom: '100% + / %2F' })
      expect(await getRawUserVariablesFromUrlParams()).toEqual({ name: '用户 %20' })
    })

    it.each([
      ['inputs', '', getProcessedInputsFromUrlParams],
      ['system', 'sys.', getProcessedSystemVariablesFromUrlParams],
      ['user', 'user.', getProcessedUserVariablesFromUrlParams],
    ] as const)(
      'decompresses real UTF-8 gzip %s and isolates malformed values',
      async (_name, prefix, extract) => {
        setSearch(
          `?${new URLSearchParams({
            [`${prefix}valid`]: compressed('你好 👋 + 100%'),
            [`${prefix}invalid`]: 'not base64!',
            [`${prefix}notGzip`]: btoa('plain bytes'),
            [`${prefix}empty`]: compressed(''),
          })}`,
        )
        expect(await extract()).toEqual({
          valid: '你好 👋 + 100%',
          invalid: undefined,
          notGzip: undefined,
          empty: '',
        })
      },
    )

    it('selects each compressed namespace without leaking the others', async () => {
      setSearch(
        `?${new URLSearchParams({ custom: compressed('input'), 'sys.param': compressed('system'), 'user.param': compressed('user') })}`,
      )
      expect(await getProcessedInputsFromUrlParams()).toEqual({ custom: 'input' })
      expect(await getProcessedSystemVariablesFromUrlParams()).toEqual({ param: 'system' })
      expect(await getProcessedUserVariablesFromUrlParams()).toEqual({ param: 'user' })
    })

    it('merges redirect system variables and gives redirect values precedence', async () => {
      const redirect = `https://example.com?${new URLSearchParams({ 'sys.param': compressed('redirect'), 'sys.extra': compressed('extra'), custom: compressed('ignored') })}`
      setSearch(
        `?${new URLSearchParams({ redirect_url: redirect, 'sys.param': compressed('outer') })}`,
      )
      expect(await getProcessedSystemVariablesFromUrlParams()).toEqual({
        param: 'redirect',
        extra: 'extra',
      })
    })

    it('keeps system variables when the redirect has no query', async () => {
      setSearch(
        `?${new URLSearchParams({ redirect_url: 'https://example.com', 'sys.param': compressed('outer') })}`,
      )
      expect(await getProcessedSystemVariablesFromUrlParams()).toEqual({ param: 'outer' })
    })
  })

  describe('Answer Validation', () => {
    it('isValidGeneratedAnswer returns true for typical answers', () => {
      expect(
        isValidGeneratedAnswer({
          isAnswer: true,
          id: '123',
          isOpeningStatement: false,
        } as ChatItem),
      ).toBe(true)
    })

    it('isValidGeneratedAnswer returns false for placeholders', () => {
      expect(
        isValidGeneratedAnswer({
          isAnswer: true,
          id: 'answer-placeholder-123',
          isOpeningStatement: false,
        } as ChatItem),
      ).toBe(false)
    })

    it('isValidGeneratedAnswer returns false for opening statements', () => {
      expect(
        isValidGeneratedAnswer({ isAnswer: true, id: '123', isOpeningStatement: true } as ChatItem),
      ).toBe(false)
    })

    it('isValidGeneratedAnswer returns false for questions', () => {
      expect(
        isValidGeneratedAnswer({
          isAnswer: false,
          id: '123',
          isOpeningStatement: false,
        } as ChatItem),
      ).toBe(false)
    })

    it('isValidGeneratedAnswer returns false for falsy items', () => {
      expect(isValidGeneratedAnswer(undefined)).toBe(false)
    })

    it('getLastAnswer returns the last valid answer from a list', () => {
      const list = [
        { isAnswer: false, id: 'q1', isOpeningStatement: false },
        { isAnswer: true, id: 'a1', isOpeningStatement: false },
        { isAnswer: false, id: 'q2', isOpeningStatement: false },
        { isAnswer: true, id: 'answer-placeholder-2', isOpeningStatement: false },
      ] as ChatItem[]
      expect(getLastAnswer(list)?.id).toBe('a1')
    })

    it('getLastAnswer returns null if no valid answer', () => {
      const list = [
        { isAnswer: false, id: 'q1', isOpeningStatement: false },
        { isAnswer: true, id: 'answer-placeholder-2', isOpeningStatement: false },
      ] as ChatItem[]
      expect(getLastAnswer(list)).toBeNull()
    })
  })

  describe('ChatItem Tree Builders', () => {
    it('buildChatItemTree builds nested tree based on parentMessageId', () => {
      const list: IChatItem[] = [
        { id: 'q1', isAnswer: false, parentMessageId: null } as IChatItem,
        { id: 'a1', isAnswer: true } as IChatItem,
        { id: 'q2', isAnswer: false, parentMessageId: 'a1' } as IChatItem,
        { id: 'a2', isAnswer: true } as IChatItem,
        { id: 'q3', isAnswer: false, parentMessageId: 'a1' } as IChatItem,
        { id: 'a3', isAnswer: true } as IChatItem,
        { id: 'q4', isAnswer: false, parentMessageId: 'missing-parent' } as IChatItem,
        { id: 'a4', isAnswer: true } as IChatItem,
      ]

      const tree = buildChatItemTree(list)
      expect(tree.length).toBe(2)
      expect(tree[0]!.id).toBe('q1')
      expect(tree[1]!.id).toBe('q4')

      const a1 = tree[0]!.children![0]
      expect(a1!.id).toBe('a1')
      expect(a1!.children?.length).toBe(2)
      expect(a1!.children![0]!.id).toBe('q2')
      expect(a1!.children![1]!.id).toBe('q3')
      expect(a1!.children![0]!.children![0]!.siblingIndex).toBe(0)
      expect(a1!.children![1]!.children![0]!.siblingIndex).toBe(1)
    })

    it('buildChatItemTree keeps out-of-order children under their parent when the parent appears later', () => {
      const list: IChatItem[] = [
        { id: 'q2', isAnswer: false, parentMessageId: 'a1' } as IChatItem,
        { id: 'a2', isAnswer: true } as IChatItem,
        { id: 'q1', isAnswer: false, parentMessageId: null } as IChatItem,
        { id: 'a1', isAnswer: true } as IChatItem,
      ]

      const tree = buildChatItemTree(list)

      expect(tree).toHaveLength(1)
      expect(tree[0]!.id).toBe('q1')
      expect(tree[0]!.children![0]!.id).toBe('a1')
      expect(tree[0]!.children![0]!.children![0]!.id).toBe('q2')
      expect(tree[0]!.children![0]!.children![0]!.children![0]!.id).toBe('a2')
    })

    it('getThreadMessages node without children', () => {
      const tree = [{ id: 'q1', isAnswer: false }]
      const thread = getThreadMessages(tree as ChatItemInTree[], 'q1')
      expect(thread.length).toBe(1)
      expect(thread[0]!.id).toBe('q1')
    })

    it('getThreadMessages target not found', () => {
      const tree = [{ id: 'q1', isAnswer: false, children: [] }]
      const thread = getThreadMessages(tree as unknown as ChatItemInTree[], 'missing')
      expect(thread.length).toBe(0)
    })

    it('getThreadMessages targetNode has descendants', () => {
      const tree = [
        {
          id: 'q1',
          isAnswer: false,
          children: [
            {
              id: 'a1',
              isAnswer: true,
              siblingIndex: 0,
              children: [
                {
                  id: 'q2',
                  isAnswer: false,
                  children: [
                    {
                      id: 'a2',
                      isAnswer: true,
                      siblingIndex: 0,
                      children: [],
                    },
                  ],
                },
                {
                  id: 'q3',
                  isAnswer: false,
                  children: [
                    {
                      id: 'a3',
                      isAnswer: true,
                      siblingIndex: 1,
                      children: [],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ]

      const thread = getThreadMessages(tree as unknown as ChatItemInTree[], 'a1')
      expect(thread.length).toBe(4)
      expect(thread.map((t) => t.id)).toEqual(['q1', 'a1', 'q3', 'a3'])
      expect(thread[3]!.prevSibling).toBe('a2')
    })
  })
})
