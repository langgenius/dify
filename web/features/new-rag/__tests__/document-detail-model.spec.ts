import type {
  KnowledgeFsDocumentMultimodalItemResponse,
  KnowledgeFsDocumentOutlineNodeResponse,
} from '@dify/contracts/api/console/knowledge-fs/types.gen'
import type {
  DocumentRevisionChunk,
  LogicalDocument,
  LogicalDocumentRevision,
} from '../document-models'
import {
  buildDocumentDetailModel,
  chunkCharacterCount,
  chunkContentParts,
  chunkMetadataEntries,
  chunkTreeLabel,
  initialDocumentRevision,
  placeDocumentMultimodalItems,
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
          end_offset: 42,
          kind: 'table',
          section_path: ['Invoices', 'Tax breakdown'],
          start_offset: 21,
        },
        { ...base, id: 'legacy' },
      ],
    })

    expect(result.items[0]).toMatchObject({
      kind: 'table',
      endOffset: 42,
      sectionPath: ['Invoices', 'Tax breakdown'],
      startOffset: 21,
    })
    expect(result.items[1]).toMatchObject({ kind: 'chunk', sectionPath: [] })
  })

  it('places extracted images by canonical offsets and falls back to section paths', () => {
    const images: KnowledgeFsDocumentMultimodalItemResponse[] = [
      {
        asset_url: '/image-1',
        id: 'image-1',
        modality: 'image',
        parse_element_id: 'parse-image-1',
        section_path: ['Guide'],
        start_offset: 10,
      },
      {
        asset_url: '/image-2',
        id: 'image-2',
        modality: 'image',
        parse_element_id: 'parse-image-2',
        section_path: ['Appendix'],
      },
      {
        asset_url: '/table-1',
        id: 'table-1',
        modality: 'table',
        parse_element_id: 'parse-table-1',
      },
      {
        id: 'image-unplaced',
        modality: 'image',
        parse_element_id: 'parse-image-unplaced',
      },
    ]
    const placement = placeDocumentMultimodalItems(
      [
        chunk({ endOffset: 10, id: 'guide-1', ordinal: 1, sectionPath: ['Guide'], startOffset: 0 }),
        chunk({
          endOffset: 30,
          id: 'guide-2',
          ordinal: 2,
          sectionPath: ['Guide'],
          startOffset: 10,
        }),
        chunk({ id: 'appendix', ordinal: 3, sectionPath: ['Appendix'] }),
      ],
      images,
    )

    expect(placement.byChunkId.get('guide-2')?.map((item) => item.id)).toEqual(['image-1'])
    expect(placement.byChunkId.get('appendix')?.map((item) => item.id)).toEqual(['image-2'])
    expect(placement.unplaced.map((item) => item.id)).toEqual(['image-unplaced'])
  })

  it('keeps image index nodes out of the reading view when their asset is rendered in place', () => {
    const items = [
      {
        asset_url: '/image-1',
        id: 'manifest-image-1',
        modality: 'image' as const,
        parse_element_id: 'parse-image-1',
        start_offset: 10,
      },
    ]
    const model = buildDocumentDetailModel(
      [
        chunk({
          endOffset: 40,
          id: 'spreadsheet-record',
          kind: 'table',
          ordinal: 0,
          startOffset: 0,
          text: 'Issue: Copy button is unavailable',
          userMetadata: { elementIds: ['parse-table-1'] },
        }),
        chunk({
          endOffset: 60,
          id: 'image-index-node',
          kind: 'image',
          ordinal: 1,
          startOffset: 41,
          text: 'image1.jpeg',
          userMetadata: { elementIds: ['parse-image-1'] },
        }),
      ],
      [],
      items,
    )

    expect(model.sourceChunks.map((item) => item.id)).toEqual([
      'spreadsheet-record',
      'image-index-node',
    ])
    expect(model.contentBlocks.map((block) => block.chunk.id)).toEqual(['spreadsheet-record'])
    expect(model.indexChunks.map((item) => item.id)).toEqual(['spreadsheet-record'])
    expect(model.tree.roots.map((node) => node.targetChunkId)).toEqual(['spreadsheet-record'])
    expect(placeDocumentMultimodalItems(model.indexChunks, items).unplaced).toEqual([])
  })

  it('builds the chapter hierarchy from structured section paths instead of chunk text', () => {
    const { tree } = buildDocumentDetailModel([
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
    const model = buildDocumentDetailModel(
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

    expect(model.tree.roots.map((node) => node.id)).toEqual(['guide-node'])
    expect(model.tree.roots[0]?.children.map((node) => node.id)).toEqual(['setup-node'])
    expect(model.sourceChunks.map((item) => item.id)).toEqual(['html-title', 'guide', 'setup'])
    expect(model.indexChunks.map((item) => item.id)).toEqual(['guide', 'setup'])
    expect(model.contentBlocks.map((block) => block.chunk.id)).toEqual(['guide', 'setup'])
    expect(model.contentBlocksByChunkId.get('setup')?.summary).toBe('Generated setup summary.')
  })

  it('models structural headings once and keeps following section content heading-free', () => {
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
    const model = buildDocumentDetailModel(
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

    expect(model.tree.roots.map((node) => node.id)).toEqual(['detailed-features'])
    expect(model.tree.roots[0]?.targetChunkId).toBe('chapter-heading')
    expect(model.tree.roots[0]?.children[0]?.targetChunkId).toBe('section-heading')
    expect(
      model.contentBlocks.map((block) => ({
        body: block.body,
        heading: block.heading,
        id: block.chunk.id,
        markerLabel: block.markerLabel,
      })),
    ).toEqual([
      {
        body: '',
        heading: { level: 1, text: 'Detailed features' },
        id: 'chapter-heading',
        markerLabel: undefined,
      },
      {
        body: '',
        heading: { level: 2, text: 'Document upload' },
        id: 'section-heading',
        markerLabel: undefined,
      },
      {
        body: 'Files are parsed and indexed in the background.',
        heading: undefined,
        id: 'section-body',
        markerLabel: 'C-1',
      },
    ])
    expect(model.indexChunks.map((item) => item.id)).toEqual(['section-body'])
  })

  it('builds a deterministic parent-child tree and keeps orphans visible', () => {
    const { tree } = buildDocumentDetailModel([
      chunk({ id: 'child-b', ordinal: 3, parentChunkId: 'parent' }),
      chunk({ id: 'parent', ordinal: 1 }),
      chunk({ id: 'orphan', ordinal: 2, parentChunkId: 'missing' }),
      chunk({ id: 'child-a', ordinal: 2, parentChunkId: 'parent' }),
    ])

    expect(tree.roots.map((node) => node.targetChunkId)).toEqual(['parent', 'orphan'])
    expect(tree.byId.get('parent')?.children.map((node) => node.targetChunkId)).toEqual([
      'child-a',
      'child-b',
    ])
  })

  it('uses chunk content for unsectioned labels and a one-based fallback for empty chunks', () => {
    const { tree } = buildDocumentDetailModel([
      chunk({ id: 'first', ordinal: 0, text: 'Product use and differentiation' }),
      chunk({ id: 'empty', ordinal: 1, text: '' }),
    ])

    expect(tree.roots.map((node) => node.label)).toEqual(['Product use and differentiation', '#2'])
  })

  it('breaks cyclic parent links instead of losing every node', () => {
    const { tree } = buildDocumentDetailModel([
      chunk({ id: 'cycle-a', ordinal: 1, parentChunkId: 'cycle-b' }),
      chunk({ id: 'cycle-b', ordinal: 2, parentChunkId: 'cycle-a' }),
      chunk({ id: 'self', ordinal: 3, parentChunkId: 'self' }),
    ])

    expect(tree.roots.map((node) => node.targetChunkId)).toEqual(['cycle-a', 'cycle-b', 'self'])
  })

  it('builds a long parent chain without repeated ancestor walks', () => {
    const chunks = Array.from({ length: 5000 }, (_, index) =>
      chunk({
        id: `chunk-${index}`,
        ordinal: index,
        parentChunkId: index ? `chunk-${index - 1}` : undefined,
      }),
    )

    const { tree } = buildDocumentDetailModel(chunks)
    const visible = visibleDocumentChunkNodes(tree.roots, new Set(tree.byId.keys()))

    expect(tree.byId).toHaveLength(5000)
    expect(tree.roots.map((node) => node.targetChunkId)).toEqual(['chunk-0'])
    expect(visible).toHaveLength(5000)
    expect(visible.at(-1)).toMatchObject({ depth: 4999 })
  })

  it('flattens only expanded descendants in tree order', () => {
    const { tree } = buildDocumentDetailModel([
      chunk({ id: 'parent', ordinal: 1 }),
      chunk({ id: 'child', ordinal: 2, parentChunkId: 'parent' }),
      chunk({ id: 'grandchild', ordinal: 3, parentChunkId: 'child' }),
    ])

    expect(
      visibleDocumentChunkNodes(tree.roots, new Set()).map(({ node }) => node.targetChunkId),
    ).toEqual(['parent'])
    expect(
      visibleDocumentChunkNodes(tree.roots, new Set(['parent', 'child'])).map(
        ({ depth, node }) => `${depth}:${node.targetChunkId}`,
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
