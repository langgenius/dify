import { buildTreeFromFlatList } from '../utils'

describe('artifacts utils', () => {
  it('should build nested tree nodes from a flat node list', () => {
    const tree = buildTreeFromFlatList([
      {
        path: 'folder',
        is_dir: true,
        size: 0,
        mtime: 1,
        extension: null,
      },
      {
        path: 'folder/readme.md',
        is_dir: false,
        size: 12,
        mtime: 2,
        extension: 'md',
      },
      {
        path: 'logo.png',
        is_dir: false,
        size: 3,
        mtime: 3,
        extension: 'png',
      },
    ])

    expect(tree).toEqual([
      expect.objectContaining({
        id: 'folder',
        node_type: 'folder',
        children: [
          expect.objectContaining({
            id: 'folder/readme.md',
            node_type: 'file',
            extension: 'md',
          }),
        ],
      }),
      expect.objectContaining({
        id: 'logo.png',
        node_type: 'file',
        children: [],
      }),
    ])
  })

  it('should skip nodes whose parent path does not exist in the flat list', () => {
    const tree = buildTreeFromFlatList([
      {
        path: 'missing-parent/readme.md',
        is_dir: false,
        size: 7,
        mtime: 1,
        extension: 'md',
      },
    ])

    expect(tree).toEqual([])
  })
})
