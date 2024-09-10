import type { IChatItem } from '../chat/type'
import { buildChatItemTree } from '../utils'
import branchedTestMessages from './branchedTestMessages.json'
import legacyTestMessages from './legacyTestMessages.json'
import mixedTestMessages from './mixedTestMessages.json'
import multiRootNodesMessages from './multiRootNodesMessages.json'
import multiRootNodesWithLegacyTestMessages from './multiRootNodesWithLegacyTestMessages.json'

describe('buildChatItemTree', () => {
  it('should build a tree from a list of chat items', () => {
    const tree1 = buildChatItemTree(branchedTestMessages as IChatItem[])
    expect(tree1).toMatchSnapshot()
  })

  it('should be compatible with legacy chat items', () => {
    const tree2 = buildChatItemTree(legacyTestMessages as IChatItem[])
    expect(tree2).toMatchSnapshot()
  })

  it('should build a tree from a list of mixed chat items', () => {
    const tree3 = buildChatItemTree(mixedTestMessages as IChatItem[])
    expect(tree3).toMatchSnapshot()
  })

  it('should build a tree from a list of multi root nodes chat items', () => {
    const tree4 = buildChatItemTree(multiRootNodesMessages as IChatItem[])
    expect(tree4).toMatchSnapshot()
  })

  it('should build a tree from a list of multi root nodes chat items with legacy chat items', () => {
    const tree5 = buildChatItemTree(multiRootNodesWithLegacyTestMessages as IChatItem[])
    expect(tree5).toMatchSnapshot()
  })
})
