import type {
  DocumentRevisionChunk,
  LogicalDocument,
  LogicalDocumentRevision,
} from '@dify/contracts/knowledge-fs/types.gen'
import {
  buildDocumentChunkTree,
  chunkCharacterCount,
  chunkContentParts,
  chunkMetadataEntries,
  chunkTreeLabel,
  initialDocumentRevision,
  visibleDocumentChunkNodes,
} from '../document-detail-model'

const chunk = (overrides: Partial<DocumentRevisionChunk>): DocumentRevisionChunk => ({
  createdAt: '2026-07-21T10:00:00Z',
  documentId: 'document-1',
  documentRevision: 3,
  enabled: true,
  id: 'chunk-1',
  knowledgeSpaceId: 'space-1',
  ordinal: 1,
  text: 'Chunk content',
  tokenCount: 2,
  userMetadata: {},
  ...overrides,
})

const document = (overrides: Partial<LogicalDocument> = {}): LogicalDocument => ({
  active: {
    contentHash: 'hash-3',
    createdAt: '2026-07-21T10:00:00Z',
    documentAssetId: 'asset-1',
    documentAssetVersion: 1,
    documentId: 'document-1',
    knowledgeSpaceId: 'space-1',
    mimeType: 'text/markdown',
    revision: 3,
    sizeBytes: 1200,
    state: 'active',
  },
  activeRevision: 3,
  createdAt: '2026-07-21T09:00:00Z',
  id: 'document-1',
  knowledgeSpaceId: 'space-1',
  rowVersion: 2,
  status: 'ready',
  title: 'SSO enterprise',
  updatedAt: '2026-07-21T10:00:00Z',
  userMetadata: {},
  ...overrides,
})

const revision = (value: number): Exclude<LogicalDocumentRevision, null> => ({
  contentHash: `hash-${value}`,
  createdAt: `2026-07-21T0${value}:00:00Z`,
  documentAssetId: 'asset-1',
  documentAssetVersion: value,
  documentId: 'document-1',
  knowledgeSpaceId: 'space-1',
  mimeType: 'text/markdown',
  revision: value,
  sizeBytes: value * 100,
  state: value === 3 ? 'active' : 'superseded',
})

describe('document detail model', () => {
  it('builds a deterministic parent-child tree and keeps orphans visible', () => {
    const tree = buildDocumentChunkTree([
      chunk({ id: 'child-b', ordinal: 3, parentChunkId: 'parent' }),
      chunk({ id: 'parent', ordinal: 1 }),
      chunk({ id: 'orphan', ordinal: 2, parentChunkId: 'missing' }),
      chunk({ id: 'child-a', ordinal: 2, parentChunkId: 'parent' }),
    ])

    expect(tree.roots.map((node) => node.chunk.id)).toEqual(['parent', 'orphan'])
    expect(tree.byId.get('parent')?.children.map((node) => node.chunk.id)).toEqual([
      'child-a',
      'child-b',
    ])
  })

  it('breaks cyclic parent links instead of losing every node', () => {
    const tree = buildDocumentChunkTree([
      chunk({ id: 'cycle-a', ordinal: 1, parentChunkId: 'cycle-b' }),
      chunk({ id: 'cycle-b', ordinal: 2, parentChunkId: 'cycle-a' }),
      chunk({ id: 'self', ordinal: 3, parentChunkId: 'self' }),
    ])

    expect(tree.roots.map((node) => node.chunk.id)).toEqual(['cycle-a', 'cycle-b', 'self'])
  })

  it('builds a long parent chain without repeated ancestor walks', () => {
    const chunks = Array.from({ length: 5000 }, (_, index) =>
      chunk({
        id: `chunk-${index}`,
        ordinal: index,
        parentChunkId: index ? `chunk-${index - 1}` : undefined,
      }),
    )

    const tree = buildDocumentChunkTree(chunks)
    const visible = visibleDocumentChunkNodes(tree.roots, new Set(tree.byId.keys()))

    expect(tree.byId).toHaveLength(5000)
    expect(tree.roots.map((node) => node.chunk.id)).toEqual(['chunk-0'])
    expect(visible).toHaveLength(5000)
    expect(visible.at(-1)).toMatchObject({ depth: 4999 })
  })

  it('flattens only expanded descendants in tree order', () => {
    const tree = buildDocumentChunkTree([
      chunk({ id: 'parent', ordinal: 1 }),
      chunk({ id: 'child', ordinal: 2, parentChunkId: 'parent' }),
      chunk({ id: 'grandchild', ordinal: 3, parentChunkId: 'child' }),
    ])

    expect(
      visibleDocumentChunkNodes(tree.roots, new Set()).map(({ node }) => node.chunk.id),
    ).toEqual(['parent'])
    expect(
      visibleDocumentChunkNodes(tree.roots, new Set(['parent', 'child'])).map(
        ({ depth, node }) => `${depth}:${node.chunk.id}`,
      ),
    ).toEqual(['0:parent', '1:child', '2:grandchild'])
  })

  it('selects the active revision and falls back to the newest available revision', () => {
    expect(initialDocumentRevision(document(), [revision(1), revision(2), revision(3)])).toBe(3)
    expect(
      initialDocumentRevision(document({ active: null, activeRevision: undefined }), [
        revision(1),
        revision(2),
      ]),
    ).toBe(2)
    expect(initialDocumentRevision(document({ active: null, activeRevision: undefined }), [])).toBe(
      undefined,
    )
    expect(
      initialDocumentRevision(document({ active: null, activeRevision: undefined }), [
        { ...revision(4), state: 'failed' },
        { ...revision(5), state: 'candidate' },
      ]),
    ).toBeUndefined()
    expect(
      initialDocumentRevision(document({ active: null, activeRevision: undefined }), [
        revision(2),
        { ...revision(4), state: 'failed' },
      ]),
    ).toBe(2)
  })

  it('counts unicode characters and formats metadata deterministically', () => {
    expect(chunkCharacterCount('A📙B')).toBe(3)
    expect(chunkCharacterCount('👨‍👩‍👧‍👦')).toBe(1)
    expect(
      chunkMetadataEntries({
        page: 2,
        section: 'Security',
        tags: ['sso', 'saml'],
      }),
    ).toEqual([
      ['page', '2'],
      ['section', 'Security'],
      ['tags', '["sso","saml"]'],
    ])
  })

  it('bounds tree labels to a single readable summary', () => {
    expect(chunkTreeLabel('First line\nfull body', 3)).toBe('First line')
    expect(chunkTreeLabel('  ', 3)).toBe('#3')
    expect(chunkTreeLabel('x'.repeat(121), 3)).toBe(`${'x'.repeat(119)}…`)
    expect(chunkTreeLabel(`${'x'.repeat(118)}👨‍👩‍👧‍👦yz`, 3)).toBe(`${'x'.repeat(118)}👨‍👩‍👧‍👦…`)
  })

  it('separates multiline chunk headings without duplicating standalone content', () => {
    expect(chunkContentParts('Setup requirements\n\nWorkspace contract details')).toEqual({
      body: 'Workspace contract details',
      heading: 'Setup requirements',
    })
    expect(chunkContentParts('Standalone content')).toEqual({
      body: '',
      heading: 'Standalone content',
    })
  })
})
