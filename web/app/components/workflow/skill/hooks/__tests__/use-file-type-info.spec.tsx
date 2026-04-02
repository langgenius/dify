import { renderHook } from '@testing-library/react'
import { useFileTypeInfo } from '../use-file-type-info'

describe('useFileTypeInfo', () => {
  it('should return a non-previewable default state when the file node is missing', () => {
    const { result } = renderHook(() => useFileTypeInfo(undefined))

    expect(result.current).toEqual({
      isMarkdown: false,
      isCodeOrText: false,
      isImage: false,
      isVideo: false,
      isPdf: false,
      isSQLite: false,
      isEditable: false,
      isMediaFile: false,
      isPreviewable: false,
    })
  })

  it('should classify markdown and editable files from their file name', () => {
    const { result } = renderHook(() => useFileTypeInfo({
      name: 'README.md',
    }))

    expect(result.current.isMarkdown).toBe(true)
    expect(result.current.isEditable).toBe(true)
    expect(result.current.isCodeOrText).toBe(false)
    expect(result.current.isPreviewable).toBe(true)
  })

  it('should use an explicit extension override when provided', () => {
    const { result } = renderHook(() => useFileTypeInfo({
      name: 'README',
      extension: '.PDF',
    }))

    expect(result.current.isPdf).toBe(true)
    expect(result.current.isPreviewable).toBe(true)
    expect(result.current.isEditable).toBe(false)
  })

  it('should fall back to the file name when the explicit extension is null', () => {
    const { result } = renderHook(() => useFileTypeInfo({
      name: 'clip.mp4',
      extension: null,
    }))

    expect(result.current.isVideo).toBe(true)
    expect(result.current.isMediaFile).toBe(true)
    expect(result.current.isPreviewable).toBe(true)
  })

  it('should classify sqlite files as non-editable previews', () => {
    const { result } = renderHook(() => useFileTypeInfo({
      name: 'data.sqlite',
    }))

    expect(result.current.isSQLite).toBe(true)
    expect(result.current.isEditable).toBe(false)
    expect(result.current.isPreviewable).toBe(true)
  })
})
