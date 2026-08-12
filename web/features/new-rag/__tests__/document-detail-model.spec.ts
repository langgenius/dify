import type { KnowledgeFsDocumentOutlineNodeResponse } from '@dify/contracts/api/console/knowledge-fs/types.gen'
import type {
  DocumentRevisionChunk,
  LogicalDocument,
  LogicalDocumentRevision,
} from '../document-models'
import {
  buildDocumentChunkTree,
  chunkCharacterCount,
  chunkContentParts,
  chunkMetadataEntries,
  chunkTreeLabel,
  initialDocumentRevision,
  visibleDocumentChunkNodes,
} from '../document-detail-model'
import { documentChunkListFromApi } from '../document-models'

const chunk = (overrides: Partial<DocumentRevisionChunk>): DocumentRevisionChunk => ({
  createdAt: '2026-07-21T10:00:00Z',
  documentId: 'document-1',
  documentRevision: 3,
  enabled: true,
  id: 'chunk-1',
  kind: 'chunk',
  knowledgeSpaceId: 'space-1',
  ordinal: 1,
  sectionPath: [],
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
  enabled: true,
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

const outlineNode = (
  overrides: Partial<KnowledgeFsDocumentOutlineNodeResponse> = {},
): KnowledgeFsDocumentOutlineNodeResponse => ({
  children: [],
  id: 'outline-1',
  level: 1,
  metadata: {},
  section_path: ['Guide'],
  summary: 'A generated guide summary.',
  title: 'Guide',
  toc_source: 'parser-heading',
  ...overrides,
})

describe('document detail model', () => {
  it('maps structured chunk metadata and remains compatible with legacy responses', () => {
    const base = {
      created_at: '2026-07-21T10:00:00Z',
      document_id: 'document-1',
      document_revision: 3,
      enabled: true,
      knowledge_space_id: 'space-1',
      ordinal: 1,
      text: 'Chunk content',
      token_count: 2,
      user_metadata: {},
    }

    const result = documentChunkListFromApi({
      data: [
        {
          ...base,
          id: 'structured',
          kind: 'table',
          section_path: ['Invoices', 'Tax breakdown'],
        },
        { ...base, id: 'legacy' },
      ],
    })

    expect(result.items[0]).toMatchObject({
      kind: 'table',
      sectionPath: ['Invoices', 'Tax breakdown'],
    })
    expect(result.items[1]).toMatchObject({ kind: 'chunk', sectionPath: [] })
  })

  it('builds the chapter hierarchy from structured section paths instead of chunk text', () => {
    const tree = buildDocumentChunkTree([
      chunk({
        id: 'tax-table',
        ordinal: 3,
        sectionPath: ['Invoices', 'Tax breakdown'],
        text: 'A first line that is not a chapter title',
      }),
      chunk({
        id: 'invoice-intro',
        ordinal: 1,
        sectionPath: ['Invoices'],
        text: 'Body only',
      }),
    ])

    expect(tree.roots.map((node) => node.label)).toEqual(['Invoices'])
    expect(tree.roots[0]?.children.map((node) => node.label)).toEqual(['Tax breakdown'])
    expect(tree.roots[0]?.targetChunkId).toBe('invoice-intro')
    expect(tree.roots[0]?.children[0]?.targetChunkId).toBe('tax-table')
  })

  it('uses the persisted outline hierarchy and hides a legacy HTML title chunk', () => {
    const titleChunk = chunk({
      id: 'html-title',
      ordinal: 0,
      sectionPath: [],
      text: 'Guide — Operating safely',
    })
    const guideChunk = chunk({
      id: 'guide',
      ordinal: 1,
      sectionPath: ['Guide Operating safely'],
      text: 'Guide Operating safely\n\nGuide body',
    })
    const setupChunk = chunk({
      id: 'setup',
      ordinal: 2,
      sectionPath: ['Guide Operating safely', 'Setup'],
      text: 'Setup\n\nSetup body',
    })
    const tree = buildDocumentChunkTree(
      [titleChunk, guideChunk, setupChunk],
      [
        outlineNode({
          id: 'legacy-title-root',
          section_path: ['Guide — Operating safely'],
          summary: 'Legacy metadata title.',
          title: 'Guide — Operating safely',
        }),
        outlineNode({
          children: [
            outlineNode({
              id: 'setup-node',
              level: 2,
              section_path: ['Guide Operating safely', 'Setup'],
              summary: 'Generated setup summary.',
              title: 'Setup',
            }),
          ],
          id: 'guide-node',
          section_path: ['Guide Operating safely'],
          title: 'Guide Operating safely',
        }),
      ],
    )

    expect(tree.roots.map((node) => node.id)).toEqual(['guide-node'])
    expect(tree.roots[0]?.children.map((node) => node.id)).toEqual(['setup-node'])
    expect(tree.displayChunks.map((item) => item.id)).toEqual(['guide', 'setup'])
    expect(tree.outlineNodesByChunkId.get('setup')?.summary).toBe('Generated setup summary.')
    expect(tree.outlineSummaryChunkIds.has('setup')).toBe(true)
  })

  it('keeps structural outline headings in the tree without rendering them as empty chunks', () => {
    const chapterHeading = chunk({
      id: 'chapter-heading',
      ordinal: 0,
      sectionPath: ['Detailed features'],
      text: 'Detailed features',
    })
    const sectionHeading = chunk({
      id: 'section-heading',
      ordinal: 1,
      sectionPath: ['Detailed features', 'Document upload'],
      text: 'Document upload',
    })
    const sectionBody = chunk({
      id: 'section-body',
      ordinal: 2,
      sectionPath: ['Detailed features', 'Document upload'],
      text: 'Document upload\n\nFiles are parsed and indexed in the background.',
    })
    const tree = buildDocumentChunkTree(
      [chapterHeading, sectionHeading, sectionBody],
      [
        outlineNode({
          children: [
            outlineNode({
              id: 'document-upload',
              level: 2,
              section_path: ['Detailed features', 'Document upload'],
              title: 'Document upload',
            }),
          ],
          id: 'detailed-features',
          section_path: ['Detailed features'],
          title: 'Detailed features',
        }),
      ],
    )

    expect(tree.roots.map((node) => node.id)).toEqual(['detailed-features'])
    expect(tree.roots[0]?.targetChunkId).toBe('section-body')
    expect(tree.roots[0]?.children[0]?.targetChunkId).toBe('section-body')
    expect(tree.displayChunks.map((item) => item.id)).toEqual(['section-body'])
  })

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

  it('uses chunk content for unsectioned labels and a one-based fallback for empty chunks', () => {
    const tree = buildDocumentChunkTree([
      chunk({ id: 'first', ordinal: 0, text: 'Product use and differentiation' }),
      chunk({ id: 'empty', ordinal: 1, text: '' }),
    ])

    expect(tree.roots.map((node) => node.label)).toEqual(['Product use and differentiation', '#2'])
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

  it('bounds explicit tree labels without reading chunk content', () => {
    expect(chunkTreeLabel('  Tax breakdown  ')).toBe('Tax breakdown')
    expect(chunkTreeLabel('x'.repeat(121))).toBe(`${'x'.repeat(119)}…`)
    expect(chunkTreeLabel(`${'x'.repeat(118)}👨‍👩‍👧‍👦yz`)).toBe(`${'x'.repeat(118)}👨‍👩‍👧‍👦…`)
  })

  it('uses structured headings and preserves the complete chunk text', () => {
    expect(
      chunkContentParts(
        chunk({
          sectionPath: ['Guide', 'Setup requirements'],
          text: 'First source line\n\nWorkspace contract details',
        }),
      ),
    ).toEqual({
      body: 'First source line\n\nWorkspace contract details',
      heading: 'Setup requirements',
    })
    expect(chunkContentParts(chunk({ text: 'Standalone content' }))).toEqual({
      body: 'Standalone content',
      heading: '',
    })
  })

  it('removes an exact materialized section heading from the displayed chunk body', () => {
    expect(
      chunkContentParts(
        chunk({
          sectionPath: ['Guide', 'Setup requirements'],
          text: 'Setup requirements\n\nWorkspace contract details',
        }),
      ),
    ).toEqual({
      body: 'Workspace contract details',
      heading: 'Setup requirements',
    })
  })
})
