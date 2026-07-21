import { CollectionType } from '../../../tools/types'
import { createToolListData } from '../tool-list-data'
import { createToolProvider } from './factories'

describe('createToolListData', () => {
  it('normalizes letters and keeps non-alphabetic tools at the end', () => {
    const result = createToolListData(
      [
        createToolProvider({ id: 'custom', label: { en_US: '1Custom', zh_Hans: '1自定义' } }),
        createToolProvider({ id: 'chinese', label: { en_US: 'Chinese', zh_Hans: '中文' } }),
        createToolProvider({ id: 'alpha', label: { en_US: 'Alpha', zh_Hans: 'Alpha' } }),
      ],
      (tool) => tool.label.zh_Hans[0] || '',
    )

    expect(result.letters).toEqual(['A', 'Z', '#'])
    expect(result.flatTools.map(({ id, letter }) => ({ id, letter }))).toEqual([
      { id: 'alpha', letter: 'A' },
      { id: 'chinese', letter: 'Z' },
      { id: 'custom', letter: '#' },
    ])
  })

  it('sorts the flat view by letter without changing the tree view provider order', () => {
    const result = createToolListData(
      [
        createToolProvider({
          id: 'zeta',
          author: 'Zeta',
          label: { en_US: 'Zeta', zh_Hans: 'Zeta' },
        }),
        createToolProvider({
          id: 'alpha',
          author: 'Alpha',
          label: { en_US: 'Alpha', zh_Hans: 'Alpha' },
        }),
      ],
      (tool) => tool.label.en_US[0] ?? '',
    )

    expect(result.flatTools.map(({ id }) => id)).toEqual(['alpha', 'zeta'])
    expect(
      result.treeGroups.map((group) => (group.kind === 'author' ? group.author : group.category)),
    ).toEqual(['Zeta', 'Alpha'])
  })

  it('keeps author and category group identities separate without sentinel keys', () => {
    const result = createToolListData(
      [
        createToolProvider({ id: 'author', author: 'custom' }),
        createToolProvider({ id: 'category', type: CollectionType.custom }),
      ],
      () => 'A',
    )

    expect(result.treeGroups).toEqual([
      {
        kind: 'author',
        author: 'custom',
        tools: [expect.objectContaining({ id: 'author' })],
      },
      {
        kind: 'category',
        category: 'custom',
        tools: [expect.objectContaining({ id: 'category' })],
      },
    ])
  })

  it('maps workflow and data source providers to distinct categories', () => {
    const result = createToolListData(
      [
        createToolProvider({ id: 'workflow', type: CollectionType.workflow }),
        createToolProvider({ id: 'data-source', type: CollectionType.datasource }),
      ],
      () => 'A',
    )

    expect(result.treeGroups).toEqual([
      {
        kind: 'category',
        category: 'workflow',
        tools: [expect.objectContaining({ id: 'workflow' })],
      },
      {
        kind: 'category',
        category: 'data-source',
        tools: [expect.objectContaining({ id: 'data-source' })],
      },
    ])
  })

  it('merges providers across letters and keeps MCP and unknown provider identities explicit', () => {
    const lettersByToolId: Record<string, string> = {
      'author-a': 'A',
      'author-b': 'B',
      mcp: 'C',
      unknown: 'D',
    }
    const result = createToolListData(
      [
        createToolProvider({ id: 'author-a', author: 'Dify' }),
        createToolProvider({ id: 'author-b', author: 'Dify' }),
        createToolProvider({ id: 'mcp', type: CollectionType.mcp }),
        createToolProvider({ id: 'unknown', author: 'Future', type: 'future-provider' }),
      ],
      (tool) => lettersByToolId[tool.id] ?? '#',
    )

    expect(result.treeGroups).toEqual([
      {
        kind: 'author',
        author: 'Dify',
        tools: [
          expect.objectContaining({ id: 'author-a' }),
          expect.objectContaining({ id: 'author-b' }),
        ],
      },
      {
        kind: 'category',
        category: 'mcp',
        tools: [expect.objectContaining({ id: 'mcp' })],
      },
      {
        kind: 'author',
        author: 'Future',
        tools: [expect.objectContaining({ id: 'unknown' })],
      },
    ])
  })
})
