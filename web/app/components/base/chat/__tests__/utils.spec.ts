import type { IChatItem } from '../chat/type'
import { buildChatItemTree, getThreadMessages } from '../utils'
import branchedTestMessages from './branchedTestMessages.json'
import legacyTestMessages from './legacyTestMessages.json'
import mixedTestMessages from './mixedTestMessages.json'
import multiRootNodesMessages from './multiRootNodesMessages.json'
import multiRootNodesWithLegacyTestMessages from './multiRootNodesWithLegacyTestMessages.json'

describe('build chat item tree and get thread messages', () => {
  it('get thread messages', () => {
    const tree1 = buildChatItemTree(branchedTestMessages as IChatItem[])
    expect(tree1).toMatchSnapshot('tree1')

    const threadMessages1_1 = getThreadMessages(tree1)
    expect(threadMessages1_1).toMatchSnapshot('threadMessages1_1')

    const threadMessages1_2 = getThreadMessages(tree1, '3')
    expect(threadMessages1_2).toMatchSnapshot('threadMessages1_2')
  })

  it('get thread messages with legacy chat items', () => {
    const tree2 = buildChatItemTree(legacyTestMessages as IChatItem[])
    expect(tree2).toMatchSnapshot('tree2')

    const threadMessages2 = getThreadMessages(tree2)
    expect(threadMessages2).toMatchSnapshot('threadMessages2')
  })

  it('get thread messages with mixed chat items', () => {
    const tree3 = buildChatItemTree(mixedTestMessages as IChatItem[])
    expect(tree3).toMatchSnapshot('tree3')

    const threadMessages3_1 = getThreadMessages(tree3)
    expect(threadMessages3_1).toMatchSnapshot('threadMessages3_1')

    const threadMessages3_2 = getThreadMessages(tree3, '3')
    expect(threadMessages3_2).toMatchSnapshot('threadMessages3_2')
  })

  it('get thread messages with multi root nodes chat items', () => {
    const tree4 = buildChatItemTree(multiRootNodesMessages as IChatItem[])
    expect(tree4).toMatchSnapshot('tree4')

    const threadMessages4 = getThreadMessages(tree4)
    expect(threadMessages4).toMatchSnapshot('threadMessages4')
  })

  it('get thread messages with multi root nodes chat items with legacy chat items', () => {
    const tree5 = buildChatItemTree(multiRootNodesWithLegacyTestMessages as IChatItem[])
    expect(tree5).toMatchSnapshot('tree5')

    const threadMessages5 = getThreadMessages(tree5)
    expect(threadMessages5).toMatchSnapshot('threadMessages5')
  })
})
