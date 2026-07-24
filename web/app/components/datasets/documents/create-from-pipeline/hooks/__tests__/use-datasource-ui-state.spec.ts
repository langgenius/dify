import type { Datasource } from '@/app/components/rag-pipeline/components/panel/test-run/types'
import type { OnlineDriveFile } from '@/models/pipeline'
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DatasourceType, OnlineDriveFileType } from '@/models/pipeline'
import { useDatasourceUIState } from '../use-datasource-ui-state'

describe('useDatasourceUIState', () => {
  const defaultParams = {
    datasource: { nodeData: { provider_type: DatasourceType.localFile } } as unknown as Datasource,
    allFileLoaded: true,
    localFileListLength: 3,
    onlineDocumentsLength: 0,
    websitePagesLength: 0,
    selectedFileIdsLength: 0,
    onlineDriveFileList: [] as OnlineDriveFile[],
    isVectorSpaceFull: false,
    enableBilling: false,
    currentWorkspacePagesLength: 0,
    fileUploadConfig: { file_size_limit: 50, batch_count_limit: 20 },
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('datasourceType', () => {
    it('should return provider_type from datasource', () => {
      const { result } = renderHook(() => useDatasourceUIState(defaultParams))
      expect(result.current.datasourceType).toBe(DatasourceType.localFile)
    })

    it('should return undefined when no datasource', () => {
      const { result } = renderHook(() =>
        useDatasourceUIState({ ...defaultParams, datasource: undefined }),
      )
      expect(result.current.datasourceType).toBeUndefined()
    })
  })

  describe('isShowVectorSpaceFull', () => {
    it('should be false when billing disabled', () => {
      const { result } = renderHook(() =>
        useDatasourceUIState({ ...defaultParams, isVectorSpaceFull: true }),
      )
      expect(result.current.isShowVectorSpaceFull).toBe(false)
    })

    it('should be true when billing enabled and space is full for local file', () => {
      const { result } = renderHook(() =>
        useDatasourceUIState({
          ...defaultParams,
          isVectorSpaceFull: true,
          enableBilling: true,
          allFileLoaded: true,
        }),
      )
      expect(result.current.isShowVectorSpaceFull).toBe(true)
    })

    it('should be false when no datasource', () => {
      const { result } = renderHook(() =>
        useDatasourceUIState({
          ...defaultParams,
          datasource: undefined,
          isVectorSpaceFull: true,
          enableBilling: true,
        }),
      )
      expect(result.current.isShowVectorSpaceFull).toBe(false)
    })
  })

  describe('nextBtnDisabled', () => {
    it('should be true when no datasource', () => {
      const { result } = renderHook(() =>
        useDatasourceUIState({ ...defaultParams, datasource: undefined }),
      )
      expect(result.current.nextBtnDisabled).toBe(true)
    })

    it('should be false when local files loaded', () => {
      const { result } = renderHook(() => useDatasourceUIState(defaultParams))
      expect(result.current.nextBtnDisabled).toBe(false)
    })

    it('should be true when local file list empty', () => {
      const { result } = renderHook(() =>
        useDatasourceUIState({ ...defaultParams, localFileListLength: 0 }),
      )
      expect(result.current.nextBtnDisabled).toBe(true)
    })

    it('should be true when files not all loaded', () => {
      const { result } = renderHook(() =>
        useDatasourceUIState({ ...defaultParams, allFileLoaded: false }),
      )
      expect(result.current.nextBtnDisabled).toBe(true)
    })

    it('should be false for online document with documents selected', () => {
      const { result } = renderHook(() =>
        useDatasourceUIState({
          ...defaultParams,
          datasource: { nodeData: { provider_type: DatasourceType.onlineDocument } } as unknown as Datasource,
          onlineDocumentsLength: 2,
        }),
      )
      expect(result.current.nextBtnDisabled).toBe(false)
    })

    it('should be true for online document with no documents', () => {
      const { result } = renderHook(() =>
        useDatasourceUIState({
          ...defaultParams,
          datasource: { nodeData: { provider_type: DatasourceType.onlineDocument } } as unknown as Datasource,
          onlineDocumentsLength: 0,
        }),
      )
      expect(result.current.nextBtnDisabled).toBe(true)
    })
  })

  describe('showSelect', () => {
    it('should be false for local file type', () => {
      const { result } = renderHook(() => useDatasourceUIState(defaultParams))
      expect(result.current.showSelect).toBe(false)
    })

    it('should be true for online document with workspace pages', () => {
      const { result } = renderHook(() =>
        useDatasourceUIState({
          ...defaultParams,
          datasource: { nodeData: { provider_type: DatasourceType.onlineDocument } } as unknown as Datasource,
          currentWorkspacePagesLength: 5,
        }),
      )
      expect(result.current.showSelect).toBe(true)
    })

    it('should be true for online drive with non-bucket files', () => {
      const { result } = renderHook(() =>
        useDatasourceUIState({
          ...defaultParams,
          datasource: { nodeData: { provider_type: DatasourceType.onlineDrive } } as unknown as Datasource,
          onlineDriveFileList: [
            { id: '1', name: 'file.txt', type: OnlineDriveFileType.file },
          ],
        }),
      )
      expect(result.current.showSelect).toBe(true)
    })

    it('should be false for online drive showing only buckets', () => {
      const { result } = renderHook(() =>
        useDatasourceUIState({
          ...defaultParams,
          datasource: { nodeData: { provider_type: DatasourceType.onlineDrive } } as unknown as Datasource,
          onlineDriveFileList: [
            { id: '1', name: 'bucket-1', type: OnlineDriveFileType.bucket },
          ],
        }),
      )
      expect(result.current.showSelect).toBe(false)
    })
  })

  describe('totalOptions and selectedOptions', () => {
    it('should return workspace pages count for online document', () => {
      const { result } = renderHook(() =>
        useDatasourceUIState({
          ...defaultParams,
          datasource: { nodeData: { provider_type: DatasourceType.onlineDocument } } as unknown as Datasource,
          currentWorkspacePagesLength: 10,
          onlineDocumentsLength: 3,
        }),
      )
      expect(result.current.totalOptions).toBe(10)
      expect(result.current.selectedOptions).toBe(3)
    })

    it('should return undefined for local file type', () => {
      const { result } = renderHook(() => useDatasourceUIState(defaultParams))
      expect(result.current.totalOptions).toBeUndefined()
      expect(result.current.selectedOptions).toBeUndefined()
    })
  })

  describe('tip', () => {
    it('should return empty string for local file', () => {
      const { result } = renderHook(() => useDatasourceUIState(defaultParams))
      expect(result.current.tip).toBe('')
    })

    it('should return tip for online document', () => {
      const { result } = renderHook(() =>
        useDatasourceUIState({
          ...defaultParams,
          datasource: { nodeData: { provider_type: DatasourceType.onlineDocument } } as unknown as Datasource,
        }),
      )
      expect(result.current.tip).toContain('selectOnlineDocumentTip')
    })
  })
})
