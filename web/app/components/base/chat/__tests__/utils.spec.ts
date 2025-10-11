import { get } from 'lodash-es'
import { buildChatItemTree, getThreadMessages } from '../utils'
import type { ChatItemInTree } from '../types'
import branchedTestMessages from './branchedTestMessages.json'
import legacyTestMessages from './legacyTestMessages.json'
import mixedTestMessages from './mixedTestMessages.json'
import multiRootNodesMessages from './multiRootNodesMessages.json'
import multiRootNodesWithLegacyTestMessages from './multiRootNodesWithLegacyTestMessages.json'
import realWorldMessages from './realWorldMessages.json'
import partialMessages from './partialMessages.json'

function visitNode(tree: ChatItemInTree | ChatItemInTree[], path: string): ChatItemInTree {
  return get(tree, path)
}

describe('build chat item tree and get thread messages', () => {
  const tree1 = buildChatItemTree(branchedTestMessages as ChatItemInTree[])

  it('should build chat item tree1', () => {
    const a1 = visitNode(tree1, '0.children.0')
    expect(a1.id).toBe('1')
    expect(a1.children).toHaveLength(2)

    const a2 = visitNode(a1, 'children.0.children.0')
    expect(a2.id).toBe('2')
    expect(a2.siblingIndex).toBe(0)

    const a3 = visitNode(a2, 'children.0.children.0')
    expect(a3.id).toBe('3')

    const a4 = visitNode(a1, 'children.1.children.0')
    expect(a4.id).toBe('4')
    expect(a4.siblingIndex).toBe(1)
  })

  it('should get thread messages from tree1, using the last message as the target', () => {
    const threadChatItems1_1 = getThreadMessages(tree1)
    expect(threadChatItems1_1).toHaveLength(4)

    const q1 = visitNode(threadChatItems1_1, '0')
    const a1 = visitNode(threadChatItems1_1, '1')
    const q4 = visitNode(threadChatItems1_1, '2')
    const a4 = visitNode(threadChatItems1_1, '3')

    expect(q1.id).toBe('question-1')
    expect(a1.id).toBe('1')
    expect(q4.id).toBe('question-4')
    expect(a4.id).toBe('4')

    expect(a4.siblingCount).toBe(2)
    expect(a4.siblingIndex).toBe(1)
  })

  it('should get thread messages from tree1, using the message with id 3 as the target', () => {
    const threadChatItems1_2 = getThreadMessages(tree1, '3')
    expect(threadChatItems1_2).toHaveLength(6)

    const q1 = visitNode(threadChatItems1_2, '0')
    const a1 = visitNode(threadChatItems1_2, '1')
    const q2 = visitNode(threadChatItems1_2, '2')
    const a2 = visitNode(threadChatItems1_2, '3')
    const q3 = visitNode(threadChatItems1_2, '4')
    const a3 = visitNode(threadChatItems1_2, '5')

    expect(q1.id).toBe('question-1')
    expect(a1.id).toBe('1')
    expect(q2.id).toBe('question-2')
    expect(a2.id).toBe('2')
    expect(q3.id).toBe('question-3')
    expect(a3.id).toBe('3')

    expect(a2.siblingCount).toBe(2)
    expect(a2.siblingIndex).toBe(0)
  })

  const tree2 = buildChatItemTree(legacyTestMessages as ChatItemInTree[])
  it('should work with legacy chat items', () => {
    expect(tree2).toHaveLength(1)
    const q1 = visitNode(tree2, '0')
    const a1 = visitNode(q1, 'children.0')
    const q2 = visitNode(a1, 'children.0')
    const a2 = visitNode(q2, 'children.0')
    const q3 = visitNode(a2, 'children.0')
    const a3 = visitNode(q3, 'children.0')
    const q4 = visitNode(a3, 'children.0')
    const a4 = visitNode(q4, 'children.0')

    expect(q1.id).toBe('question-1')
    expect(a1.id).toBe('1')
    expect(q2.id).toBe('question-2')
    expect(a2.id).toBe('2')
    expect(q3.id).toBe('question-3')
    expect(a3.id).toBe('3')
    expect(q4.id).toBe('question-4')
    expect(a4.id).toBe('4')
  })

  it('should get thread messages from tree2, using the last message as the target', () => {
    const threadMessages2 = getThreadMessages(tree2)
    expect(threadMessages2).toHaveLength(8)

    const q1 = visitNode(threadMessages2, '0')
    const a1 = visitNode(threadMessages2, '1')
    const q2 = visitNode(threadMessages2, '2')
    const a2 = visitNode(threadMessages2, '3')
    const q3 = visitNode(threadMessages2, '4')
    const a3 = visitNode(threadMessages2, '5')
    const q4 = visitNode(threadMessages2, '6')
    const a4 = visitNode(threadMessages2, '7')

    expect(q1.id).toBe('question-1')
    expect(a1.id).toBe('1')
    expect(q2.id).toBe('question-2')
    expect(a2.id).toBe('2')
    expect(q3.id).toBe('question-3')
    expect(a3.id).toBe('3')
    expect(q4.id).toBe('question-4')
    expect(a4.id).toBe('4')

    expect(a1.siblingCount).toBe(1)
    expect(a1.siblingIndex).toBe(0)
    expect(a2.siblingCount).toBe(1)
    expect(a2.siblingIndex).toBe(0)
    expect(a3.siblingCount).toBe(1)
    expect(a3.siblingIndex).toBe(0)
    expect(a4.siblingCount).toBe(1)
    expect(a4.siblingIndex).toBe(0)
  })

  const tree3 = buildChatItemTree(mixedTestMessages as ChatItemInTree[])
  it('should build mixed chat items tree', () => {
    expect(tree3).toHaveLength(1)

    const a1 = visitNode(tree3, '0.children.0')
    expect(a1.id).toBe('1')
    expect(a1.children).toHaveLength(2)

    const a2 = visitNode(a1, 'children.0.children.0')
    expect(a2.id).toBe('2')
    expect(a2.siblingIndex).toBe(0)

    const a3 = visitNode(a2, 'children.0.children.0')
    expect(a3.id).toBe('3')

    const a4 = visitNode(a1, 'children.1.children.0')
    expect(a4.id).toBe('4')
    expect(a4.siblingIndex).toBe(1)
  })

  it('should get thread messages from tree3, using the last message as the target', () => {
    const threadMessages3_1 = getThreadMessages(tree3)
    expect(threadMessages3_1).toHaveLength(4)

    const q1 = visitNode(threadMessages3_1, '0')
    const a1 = visitNode(threadMessages3_1, '1')
    const q4 = visitNode(threadMessages3_1, '2')
    const a4 = visitNode(threadMessages3_1, '3')

    expect(q1.id).toBe('question-1')
    expect(a1.id).toBe('1')
    expect(q4.id).toBe('question-4')
    expect(a4.id).toBe('4')

    expect(a4.siblingCount).toBe(2)
    expect(a4.siblingIndex).toBe(1)
  })

  it('should get thread messages from tree3, using the message with id 3 as the target', () => {
    const threadMessages3_2 = getThreadMessages(tree3, '3')
    expect(threadMessages3_2).toHaveLength(6)

    const q1 = visitNode(threadMessages3_2, '0')
    const a1 = visitNode(threadMessages3_2, '1')
    const q2 = visitNode(threadMessages3_2, '2')
    const a2 = visitNode(threadMessages3_2, '3')
    const q3 = visitNode(threadMessages3_2, '4')
    const a3 = visitNode(threadMessages3_2, '5')

    expect(q1.id).toBe('question-1')
    expect(a1.id).toBe('1')
    expect(q2.id).toBe('question-2')
    expect(a2.id).toBe('2')
    expect(q3.id).toBe('question-3')
    expect(a3.id).toBe('3')

    expect(a2.siblingCount).toBe(2)
    expect(a2.siblingIndex).toBe(0)
  })

  const tree4 = buildChatItemTree(multiRootNodesMessages as ChatItemInTree[])
  it('should build multi root nodes chat items tree', () => {
    expect(tree4).toHaveLength(2)

    const a5 = visitNode(tree4, '1.children.0')
    expect(a5.id).toBe('5')
    expect(a5.siblingIndex).toBe(1)
  })

  it('should get thread messages from tree4, using the last message as the target', () => {
    const threadMessages4 = getThreadMessages(tree4)
    expect(threadMessages4).toHaveLength(2)

    const a1 = visitNode(threadMessages4, '0.children.0')
    expect(a1.id).toBe('5')
  })

  it('should get thread messages from tree4, using the message with id 2 as the target', () => {
    const threadMessages4_1 = getThreadMessages(tree4, '2')
    expect(threadMessages4_1).toHaveLength(6)
    const a1 = visitNode(threadMessages4_1, '1')
    expect(a1.id).toBe('1')
    const a2 = visitNode(threadMessages4_1, '3')
    expect(a2.id).toBe('2')
    const a3 = visitNode(threadMessages4_1, '5')
    expect(a3.id).toBe('3')
  })

  const tree5 = buildChatItemTree(multiRootNodesWithLegacyTestMessages as ChatItemInTree[])
  it('should work with multi root nodes chat items with legacy chat items', () => {
    expect(tree5).toHaveLength(2)

    const q5 = visitNode(tree5, '1')
    expect(q5.id).toBe('question-5')
    expect(q5.parentMessageId).toBe(null)

    const a5 = visitNode(q5, 'children.0')
    expect(a5.id).toBe('5')
    expect(a5.children).toHaveLength(0)
  })

  it('should get thread messages from tree5, using the last message as the target', () => {
    const threadMessages5 = getThreadMessages(tree5)
    expect(threadMessages5).toHaveLength(2)

    const q5 = visitNode(threadMessages5, '0')
    const a5 = visitNode(threadMessages5, '1')

    expect(q5.id).toBe('question-5')
    expect(a5.id).toBe('5')

    expect(a5.siblingCount).toBe(2)
    expect(a5.siblingIndex).toBe(1)
  })

  const tree6 = buildChatItemTree(realWorldMessages as ChatItemInTree[])
  it('should work with real world messages', () => {
    expect(tree6).toMatchSnapshot()
  })

  it ('should get thread messages from tree6, using the last message as target', () => {
    const threadMessages6_1 = getThreadMessages(tree6)
    expect(threadMessages6_1).toMatchSnapshot()
  })

  it ('should get thread messages from tree6, using specified message as target', () => {
    const threadMessages6_2 = getThreadMessages(tree6, 'ff4c2b43-48a5-47ad-9dc5-08b34ddba61b')
    expect(threadMessages6_2).toMatchSnapshot()
  })

  const partialMessages1 = (realWorldMessages as ChatItemInTree[]).slice(-10)
  const tree7 = buildChatItemTree(partialMessages1)
  it('should work with partial messages 1', () => {
    expect(tree7).toMatchSnapshot()
  })

  const partialMessages2 = partialMessages as ChatItemInTree[]
  const tree8 = buildChatItemTree(partialMessages2)
  it('should work with partial messages 2', () => {
    expect(tree8).toMatchSnapshot()
  })
})
