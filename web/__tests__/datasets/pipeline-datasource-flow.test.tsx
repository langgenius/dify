/**
 * Integration Test: Pipeline Data Source Store Composition
 *
 * Tests cross-slice interactions in the pipeline data source Zustand store.
 * The unit-level slice specs test each slice in isolation.
 * This integration test verifies:
 *   - Store initialization produces correct defaults across all slices
 *   - Cross-slice coordination (e.g. credential shared across slices)
 *   - State isolation: changes in one slice do not affect others
 *   - Full workflow simulation through credential → source → data path
 */

import type { NotionPage } from '@/models/common'
import type { CrawlResultItem, FileItem } from '@/models/datasets'
import type { OnlineDriveFile } from '@/models/pipeline'
import { createDataSourceStore } from '@/app/components/datasets/documents/create-from-pipeline/data-source/store'
import { CrawlStep } from '@/models/datasets'
import { OnlineDriveFileType } from '@/models/pipeline'

// --- Factory functions ---

const createFileItem = (id: string): FileItem => ({
  fileID: id,
  file: { id, name: `${id}.txt`, size: 1024 } as FileItem['file'],
  progress: 100,
})

const createCrawlResultItem = (url: string, title?: string): CrawlResultItem => ({
  title: title ?? `Page: ${url}`,
  markdown: `# ${title ?? url}\n\nContent for ${url}`,
  description: `Description for ${url}`,
  source_url: url,
})

const createOnlineDriveFile = (id: string, name: string, type = OnlineDriveFileType.file): OnlineDriveFile => ({
  id,
  name,
  size: 2048,
  type,
})

const createNotionPage = (pageId: string): NotionPage => ({
  page_id: pageId,
  page_name: `Page ${pageId}`,
  page_icon: null,
  is_bound: true,
  parent_id: 'parent-1',
  type: 'page',
  workspace_id: 'ws-1',
})

describe('Pipeline Data Source Store Composition - Cross-Slice Integration', () => {
  describe('Store Initialization → All Slices Have Correct Defaults', () => {
    it('should create a store with all five slices combined', () => {
      const store = createDataSourceStore()
      const state = store.getState()

      // Common slice defaults
      expect(state.currentCredentialId).toBe('')
      expect(state.currentNodeIdRef.current).toBe('')

      // Local file slice defaults
      expect(state.localFileList).toEqual([])
      expect(state.currentLocalFile).toBeUndefined()

      // Online document slice defaults
      expect(state.documentsData).toEqual([])
      expect(state.onlineDocuments).toEqual([])
      expect(state.searchValue).toBe('')
      expect(state.selectedPagesId).toEqual(new Set())

      // Website crawl slice defaults
      expect(state.websitePages).toEqual([])
      expect(state.step).toBe(CrawlStep.init)
      expect(state.previewIndex).toBe(-1)

      // Online drive slice defaults
      expect(state.breadcrumbs).toEqual([])
      expect(state.prefix).toEqual([])
      expect(state.keywords).toBe('')
      expect(state.selectedFileIds).toEqual([])
      expect(state.onlineDriveFileList).toEqual([])
      expect(state.bucket).toBe('')
      expect(state.hasBucket).toBe(false)
    })
  })

  describe('Cross-Slice Coordination: Shared Credential', () => {
    it('should set credential that is accessible from the common slice', () => {
      const store = createDataSourceStore()

      store.getState().setCurrentCredentialId('cred-abc-123')

      expect(store.getState().currentCredentialId).toBe('cred-abc-123')
    })

    it('should allow credential update independently of all other slices', () => {
      const store = createDataSourceStore()

      store.getState().setLocalFileList([createFileItem('f1')])
      store.getState().setCurrentCredentialId('cred-xyz')

      expect(store.getState().currentCredentialId).toBe('cred-xyz')
      expect(store.getState().localFileList).toHaveLength(1)
    })
  })

  describe('Local File Workflow: Set Files → Verify List → Clear', () => {
    it('should set and retrieve local file list', () => {
      const store = createDataSourceStore()
      const files = [createFileItem('f1'), createFileItem('f2'), createFileItem('f3')]

      store.getState().setLocalFileList(files)

      expect(store.getState().localFileList).toHaveLength(3)
      expect(store.getState().localFileList[0].fileID).toBe('f1')
      expect(store.getState().localFileList[2].fileID).toBe('f3')
    })

    it('should update preview ref when setting file list', () => {
      const store = createDataSourceStore()
      const files = [createFileItem('f-preview')]

      store.getState().setLocalFileList(files)

      expect(store.getState().previewLocalFileRef.current).toBeDefined()
    })

    it('should clear files by setting empty list', () => {
      const store = createDataSourceStore()

      store.getState().setLocalFileList([createFileItem('f1')])
      expect(store.getState().localFileList).toHaveLength(1)

      store.getState().setLocalFileList([])
      expect(store.getState().localFileList).toHaveLength(0)
    })

    it('should set and clear current local file selection', () => {
      const store = createDataSourceStore()
      const file = { id: 'current-file', name: 'current.txt' } as FileItem['file']

      store.getState().setCurrentLocalFile(file)
      expect(store.getState().currentLocalFile).toBeDefined()
      expect(store.getState().currentLocalFile?.id).toBe('current-file')

      store.getState().setCurrentLocalFile(undefined)
      expect(store.getState().currentLocalFile).toBeUndefined()
    })
  })

  describe('Online Document Workflow: Set Documents → Select Pages → Verify', () => {
    it('should set documents data and online documents', () => {
      const store = createDataSourceStore()
      const pages = [createNotionPage('page-1'), createNotionPage('page-2')]

      store.getState().setOnlineDocuments(pages)

      expect(store.getState().onlineDocuments).toHaveLength(2)
      expect(store.getState().onlineDocuments[0].page_id).toBe('page-1')
    })

    it('should update preview ref when setting online documents', () => {
      const store = createDataSourceStore()
      const pages = [createNotionPage('page-preview')]

      store.getState().setOnlineDocuments(pages)

      expect(store.getState().previewOnlineDocumentRef.current).toBeDefined()
      expect(store.getState().previewOnlineDocumentRef.current?.page_id).toBe('page-preview')
    })

    it('should track selected page IDs', () => {
      const store = createDataSourceStore()
      const pages = [createNotionPage('p1'), createNotionPage('p2'), createNotionPage('p3')]

      store.getState().setOnlineDocuments(pages)
      store.getState().setSelectedPagesId(new Set(['p1', 'p3']))

      expect(store.getState().selectedPagesId.size).toBe(2)
      expect(store.getState().selectedPagesId.has('p1')).toBe(true)
      expect(store.getState().selectedPagesId.has('p2')).toBe(false)
      expect(store.getState().selectedPagesId.has('p3')).toBe(true)
    })

    it('should manage search value for filtering documents', () => {
      const store = createDataSourceStore()

      store.getState().setSearchValue('meeting notes')

      expect(store.getState().searchValue).toBe('meeting notes')
    })

    it('should set and clear current document selection', () => {
      const store = createDataSourceStore()
      const page = createNotionPage('current-page')

      store.getState().setCurrentDocument(page)
      expect(store.getState().currentDocument?.page_id).toBe('current-page')

      store.getState().setCurrentDocument(undefined)
      expect(store.getState().currentDocument).toBeUndefined()
    })
  })

  describe('Website Crawl Workflow: Set Pages → Track Step → Preview', () => {
    it('should set website pages and update preview ref', () => {
      const store = createDataSourceStore()
      const pages = [
        createCrawlResultItem('https://example.com'),
        createCrawlResultItem('https://example.com/about'),
      ]

      store.getState().setWebsitePages(pages)

      expect(store.getState().websitePages).toHaveLength(2)
      expect(store.getState().previewWebsitePageRef.current?.source_url).toBe('https://example.com')
    })

    it('should manage crawl step transitions', () => {
      const store = createDataSourceStore()

      expect(store.getState().step).toBe(CrawlStep.init)

      store.getState().setStep(CrawlStep.running)
      expect(store.getState().step).toBe(CrawlStep.running)

      store.getState().setStep(CrawlStep.finished)
      expect(store.getState().step).toBe(CrawlStep.finished)
    })

    it('should set crawl result with data and timing', () => {
      const store = createDataSourceStore()
      const result = {
        data: [createCrawlResultItem('https://test.com')],
        time_consuming: 3.5,
      }

      store.getState().setCrawlResult(result)

      expect(store.getState().crawlResult?.data).toHaveLength(1)
      expect(store.getState().crawlResult?.time_consuming).toBe(3.5)
    })

    it('should manage preview index for page navigation', () => {
      const store = createDataSourceStore()

      store.getState().setPreviewIndex(2)
      expect(store.getState().previewIndex).toBe(2)

      store.getState().setPreviewIndex(-1)
      expect(store.getState().previewIndex).toBe(-1)
    })

    it('should set and clear current website selection', () => {
      const store = createDataSourceStore()
      const page = createCrawlResultItem('https://current.com')

      store.getState().setCurrentWebsite(page)
      expect(store.getState().currentWebsite?.source_url).toBe('https://current.com')

      store.getState().setCurrentWebsite(undefined)
      expect(store.getState().currentWebsite).toBeUndefined()
    })
  })

  describe('Online Drive Workflow: Breadcrumbs → File Selection → Navigation', () => {
    it('should manage breadcrumb navigation', () => {
      const store = createDataSourceStore()

      store.getState().setBreadcrumbs(['root', 'folder-a', 'subfolder'])

      expect(store.getState().breadcrumbs).toEqual(['root', 'folder-a', 'subfolder'])
    })

    it('should support breadcrumb push/pop pattern', () => {
      const store = createDataSourceStore()

      store.getState().setBreadcrumbs(['root'])
      store.getState().setBreadcrumbs([...store.getState().breadcrumbs, 'level-1'])
      store.getState().setBreadcrumbs([...store.getState().breadcrumbs, 'level-2'])

      expect(store.getState().breadcrumbs).toEqual(['root', 'level-1', 'level-2'])

      // Pop back one level
      store.getState().setBreadcrumbs(store.getState().breadcrumbs.slice(0, -1))
      expect(store.getState().breadcrumbs).toEqual(['root', 'level-1'])
    })

    it('should manage file list and selection', () => {
      const store = createDataSourceStore()
      const files = [
        createOnlineDriveFile('drive-1', 'report.pdf'),
        createOnlineDriveFile('drive-2', 'data.csv'),
        createOnlineDriveFile('drive-3', 'images', OnlineDriveFileType.folder),
      ]

      store.getState().setOnlineDriveFileList(files)
      expect(store.getState().onlineDriveFileList).toHaveLength(3)

      store.getState().setSelectedFileIds(['drive-1', 'drive-2'])
      expect(store.getState().selectedFileIds).toEqual(['drive-1', 'drive-2'])
    })

    it('should update preview ref when selecting files', () => {
      const store = createDataSourceStore()
      const files = [
        createOnlineDriveFile('drive-a', 'file-a.txt'),
        createOnlineDriveFile('drive-b', 'file-b.txt'),
      ]

      store.getState().setOnlineDriveFileList(files)
      store.getState().setSelectedFileIds(['drive-b'])

      expect(store.getState().previewOnlineDriveFileRef.current?.id).toBe('drive-b')
    })

    it('should manage bucket and prefix for S3-like navigation', () => {
      const store = createDataSourceStore()

      store.getState().setBucket('my-data-bucket')
      store.getState().setPrefix(['data', '2024'])
      store.getState().setHasBucket(true)

      expect(store.getState().bucket).toBe('my-data-bucket')
      expect(store.getState().prefix).toEqual(['data', '2024'])
      expect(store.getState().hasBucket).toBe(true)
    })

    it('should manage keywords for search filtering', () => {
      const store = createDataSourceStore()

      store.getState().setKeywords('quarterly report')
      expect(store.getState().keywords).toBe('quarterly report')
    })
  })

  describe('State Isolation: Changes to One Slice Do Not Affect Others', () => {
    it('should keep local file state independent from online document state', () => {
      const store = createDataSourceStore()

      store.getState().setLocalFileList([createFileItem('local-1')])
      store.getState().setOnlineDocuments([createNotionPage('notion-1')])

      expect(store.getState().localFileList).toHaveLength(1)
      expect(store.getState().onlineDocuments).toHaveLength(1)

      // Clearing local files should not affect online documents
      store.getState().setLocalFileList([])
      expect(store.getState().localFileList).toHaveLength(0)
      expect(store.getState().onlineDocuments).toHaveLength(1)
    })

    it('should keep website crawl state independent from online drive state', () => {
      const store = createDataSourceStore()

      store.getState().setWebsitePages([createCrawlResultItem('https://site.com')])
      store.getState().setOnlineDriveFileList([createOnlineDriveFile('d1', 'file.txt')])

      expect(store.getState().websitePages).toHaveLength(1)
      expect(store.getState().onlineDriveFileList).toHaveLength(1)

      // Clearing website pages should not affect drive files
      store.getState().setWebsitePages([])
      expect(store.getState().websitePages).toHaveLength(0)
      expect(store.getState().onlineDriveFileList).toHaveLength(1)
    })

    it('should create fully independent store instances', () => {
      const storeA = createDataSourceStore()
      const storeB = createDataSourceStore()

      storeA.getState().setCurrentCredentialId('cred-A')
      storeA.getState().setLocalFileList([createFileItem('fa-1')])

      expect(storeA.getState().currentCredentialId).toBe('cred-A')
      expect(storeB.getState().currentCredentialId).toBe('')
      expect(storeB.getState().localFileList).toEqual([])
    })
  })

  describe('Full Workflow Simulation: Credential → Source → Data → Verify', () => {
    it('should support a complete local file upload workflow', () => {
      const store = createDataSourceStore()

      // Step 1: Set credential
      store.getState().setCurrentCredentialId('upload-cred-1')

      // Step 2: Set file list
      const files = [createFileItem('upload-1'), createFileItem('upload-2')]
      store.getState().setLocalFileList(files)

      // Step 3: Select current file for preview
      store.getState().setCurrentLocalFile(files[0].file)

      // Verify all state is consistent
      expect(store.getState().currentCredentialId).toBe('upload-cred-1')
      expect(store.getState().localFileList).toHaveLength(2)
      expect(store.getState().currentLocalFile?.id).toBe('upload-1')
      expect(store.getState().previewLocalFileRef.current).toBeDefined()
    })

    it('should support a complete website crawl workflow', () => {
      const store = createDataSourceStore()

      // Step 1: Set credential
      store.getState().setCurrentCredentialId('crawl-cred-1')

      // Step 2: Init crawl
      store.getState().setStep(CrawlStep.running)

      // Step 3: Crawl completes with results
      const crawledPages = [
        createCrawlResultItem('https://docs.example.com/guide'),
        createCrawlResultItem('https://docs.example.com/api'),
        createCrawlResultItem('https://docs.example.com/faq'),
      ]
      store.getState().setCrawlResult({ data: crawledPages, time_consuming: 12.5 })
      store.getState().setStep(CrawlStep.finished)

      // Step 4: Set website pages from results
      store.getState().setWebsitePages(crawledPages)

      // Step 5: Set preview
      store.getState().setPreviewIndex(1)

      // Verify all state
      expect(store.getState().currentCredentialId).toBe('crawl-cred-1')
      expect(store.getState().step).toBe(CrawlStep.finished)
      expect(store.getState().websitePages).toHaveLength(3)
      expect(store.getState().crawlResult?.time_consuming).toBe(12.5)
      expect(store.getState().previewIndex).toBe(1)
      expect(store.getState().previewWebsitePageRef.current?.source_url).toBe('https://docs.example.com/guide')
    })

    it('should support a complete online drive navigation workflow', () => {
      const store = createDataSourceStore()

      // Step 1: Set credential
      store.getState().setCurrentCredentialId('drive-cred-1')

      // Step 2: Set bucket
      store.getState().setBucket('company-docs')
      store.getState().setHasBucket(true)

      // Step 3: Navigate into folders
      store.getState().setBreadcrumbs(['company-docs'])
      store.getState().setPrefix(['projects'])
      const folderFiles = [
        createOnlineDriveFile('proj-1', 'project-alpha', OnlineDriveFileType.folder),
        createOnlineDriveFile('proj-2', 'project-beta', OnlineDriveFileType.folder),
        createOnlineDriveFile('readme', 'README.md', OnlineDriveFileType.file),
      ]
      store.getState().setOnlineDriveFileList(folderFiles)

      // Step 4: Navigate deeper
      store.getState().setBreadcrumbs([...store.getState().breadcrumbs, 'project-alpha'])
      store.getState().setPrefix([...store.getState().prefix, 'project-alpha'])

      // Step 5: Select files
      store.getState().setOnlineDriveFileList([
        createOnlineDriveFile('doc-1', 'spec.pdf'),
        createOnlineDriveFile('doc-2', 'design.fig'),
      ])
      store.getState().setSelectedFileIds(['doc-1'])

      // Verify full state
      expect(store.getState().currentCredentialId).toBe('drive-cred-1')
      expect(store.getState().bucket).toBe('company-docs')
      expect(store.getState().breadcrumbs).toEqual(['company-docs', 'project-alpha'])
      expect(store.getState().prefix).toEqual(['projects', 'project-alpha'])
      expect(store.getState().onlineDriveFileList).toHaveLength(2)
      expect(store.getState().selectedFileIds).toEqual(['doc-1'])
      expect(store.getState().previewOnlineDriveFileRef.current?.name).toBe('spec.pdf')
    })
  })
})
