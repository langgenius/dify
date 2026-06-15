import type { NotionPage } from '@/models/common'
import type { CrawlResultItem, CustomFile } from '@/models/datasets'
import type { OnlineDriveFile } from '@/models/pipeline'
import { describe, expect, it } from 'vitest'
import { OnlineDriveFileType } from '@/models/pipeline'
import { TransferMethod } from '@/types/app'
import {
  buildLocalFileDatasourceInfo,
  buildOnlineDocumentDatasourceInfo,
  buildOnlineDriveDatasourceInfo,
  buildWebsiteCrawlDatasourceInfo,
} from '../datasource-info-builder'

describe('datasource-info-builder', () => {
  describe('buildLocalFileDatasourceInfo', () => {
    const file: CustomFile = {
      id: 'file-1',
      name: 'test.pdf',
      type: 'application/pdf',
      size: 1024,
      extension: 'pdf',
      mime_type: 'application/pdf',
    } as unknown as CustomFile

    it('should build local file datasource info', () => {
      const result = buildLocalFileDatasourceInfo(file, 'cred-1')
      expect(result).toEqual({
        related_id: 'file-1',
        name: 'test.pdf',
        type: 'application/pdf',
        size: 1024,
        extension: 'pdf',
        mime_type: 'application/pdf',
        url: '',
        transfer_method: TransferMethod.local_file,
        credential_id: 'cred-1',
      })
    })

    it('should use empty credential when not provided', () => {
      const result = buildLocalFileDatasourceInfo(file, '')
      expect(result.credential_id).toBe('')
    })
  })

  describe('buildOnlineDocumentDatasourceInfo', () => {
    const page = {
      page_id: 'page-1',
      page_name: 'My Page',
      workspace_id: 'ws-1',
      parent_id: 'root',
      type: 'page',
    } as NotionPage & { workspace_id: string }

    it('should build online document info with workspace_id separated', () => {
      const result = buildOnlineDocumentDatasourceInfo(page, 'cred-2')
      expect(result.workspace_id).toBe('ws-1')
      expect(result.credential_id).toBe('cred-2')
      expect((result.page as unknown as Record<string, unknown>).page_id).toBe('page-1')
      // workspace_id should not be in the page object
      expect((result.page as unknown as Record<string, unknown>).workspace_id).toBeUndefined()
    })
  })

  describe('buildWebsiteCrawlDatasourceInfo', () => {
    const crawlResult: CrawlResultItem = {
      source_url: 'https://example.com',
      title: 'Example',
      markdown: '# Hello',
      description: 'desc',
    } as unknown as CrawlResultItem

    it('should spread crawl result and add credential_id', () => {
      const result = buildWebsiteCrawlDatasourceInfo(crawlResult, 'cred-3')
      expect(result.source_url).toBe('https://example.com')
      expect(result.title).toBe('Example')
      expect(result.credential_id).toBe('cred-3')
    })
  })

  describe('buildOnlineDriveDatasourceInfo', () => {
    const file: OnlineDriveFile = {
      id: 'drive-1',
      name: 'doc.xlsx',
      type: OnlineDriveFileType.file,
    }

    it('should build online drive info with bucket', () => {
      const result = buildOnlineDriveDatasourceInfo(file, 'my-bucket', 'cred-4')
      expect(result).toEqual({
        bucket: 'my-bucket',
        id: 'drive-1',
        name: 'doc.xlsx',
        type: 'file',
        credential_id: 'cred-4',
      })
    })

    it('should handle empty bucket', () => {
      const result = buildOnlineDriveDatasourceInfo(file, '', 'cred-4')
      expect(result.bucket).toBe('')
    })
  })
})
