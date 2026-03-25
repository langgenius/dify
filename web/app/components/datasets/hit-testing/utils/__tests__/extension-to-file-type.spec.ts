import { describe, expect, it } from 'vitest'
import { FileAppearanceTypeEnum } from '@/app/components/base/file-uploader/types'
import { extensionToFileType } from '../extension-to-file-type'

describe('extensionToFileType', () => {
  // PDF extension
  describe('pdf', () => {
    it('should return pdf type when extension is pdf', () => {
      expect(extensionToFileType('pdf')).toBe(FileAppearanceTypeEnum.pdf)
    })
  })

  // Word extensions
  describe('word', () => {
    it('should return word type when extension is doc', () => {
      expect(extensionToFileType('doc')).toBe(FileAppearanceTypeEnum.word)
    })

    it('should return word type when extension is docx', () => {
      expect(extensionToFileType('docx')).toBe(FileAppearanceTypeEnum.word)
    })
  })

  // Markdown extensions
  describe('markdown', () => {
    it('should return markdown type when extension is md', () => {
      expect(extensionToFileType('md')).toBe(FileAppearanceTypeEnum.markdown)
    })

    it('should return markdown type when extension is mdx', () => {
      expect(extensionToFileType('mdx')).toBe(FileAppearanceTypeEnum.markdown)
    })

    it('should return markdown type when extension is markdown', () => {
      expect(extensionToFileType('markdown')).toBe(FileAppearanceTypeEnum.markdown)
    })
  })

  // Excel / CSV extensions
  describe('excel', () => {
    it('should return excel type when extension is csv', () => {
      expect(extensionToFileType('csv')).toBe(FileAppearanceTypeEnum.excel)
    })

    it('should return excel type when extension is xls', () => {
      expect(extensionToFileType('xls')).toBe(FileAppearanceTypeEnum.excel)
    })

    it('should return excel type when extension is xlsx', () => {
      expect(extensionToFileType('xlsx')).toBe(FileAppearanceTypeEnum.excel)
    })
  })

  // Document extensions
  describe('document', () => {
    it('should return document type when extension is txt', () => {
      expect(extensionToFileType('txt')).toBe(FileAppearanceTypeEnum.document)
    })

    it('should return document type when extension is epub', () => {
      expect(extensionToFileType('epub')).toBe(FileAppearanceTypeEnum.document)
    })

    it('should return document type when extension is html', () => {
      expect(extensionToFileType('html')).toBe(FileAppearanceTypeEnum.document)
    })

    it('should return document type when extension is htm', () => {
      expect(extensionToFileType('htm')).toBe(FileAppearanceTypeEnum.document)
    })

    it('should return document type when extension is xml', () => {
      expect(extensionToFileType('xml')).toBe(FileAppearanceTypeEnum.document)
    })
  })

  // PPT extensions
  describe('ppt', () => {
    it('should return ppt type when extension is ppt', () => {
      expect(extensionToFileType('ppt')).toBe(FileAppearanceTypeEnum.ppt)
    })

    it('should return ppt type when extension is pptx', () => {
      expect(extensionToFileType('pptx')).toBe(FileAppearanceTypeEnum.ppt)
    })
  })

  // Default / unknown extensions
  describe('custom (default)', () => {
    it('should return custom type when extension is empty string', () => {
      expect(extensionToFileType('')).toBe(FileAppearanceTypeEnum.custom)
    })

    it('should return custom type when extension is unknown', () => {
      expect(extensionToFileType('zip')).toBe(FileAppearanceTypeEnum.custom)
    })

    it('should return custom type when extension is uppercase (case-sensitive match)', () => {
      expect(extensionToFileType('PDF')).toBe(FileAppearanceTypeEnum.custom)
    })

    it('should return custom type when extension is mixed case', () => {
      expect(extensionToFileType('Docx')).toBe(FileAppearanceTypeEnum.custom)
    })

    it('should return custom type when extension has leading dot', () => {
      expect(extensionToFileType('.pdf')).toBe(FileAppearanceTypeEnum.custom)
    })

    it('should return custom type when extension has whitespace', () => {
      expect(extensionToFileType(' pdf ')).toBe(FileAppearanceTypeEnum.custom)
    })

    it('should return custom type for image-like extensions', () => {
      expect(extensionToFileType('png')).toBe(FileAppearanceTypeEnum.custom)
      expect(extensionToFileType('jpg')).toBe(FileAppearanceTypeEnum.custom)
    })
  })
})
