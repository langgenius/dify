import { FileAppearanceTypeEnum } from '@/app/components/base/file-uploader/types'
import {
  getFileExtension,
  getFileIconType,
  getFileLanguage,
  isBinaryFile,
  isImageFile,
  isMarkdownFile,
  isPdfFile,
  isSQLiteFile,
  isTextLikeFile,
  isVideoFile,
} from '../file-utils'

describe('file-utils', () => {
  describe('getFileExtension', () => {
    it('should prefer the explicit extension and normalize casing', () => {
      expect(getFileExtension('note.txt', '.MD')).toBe('md')
    })

    it('should derive the extension from the file name', () => {
      expect(getFileExtension('archive.TAR.GZ')).toBe('gz')
    })

    it('should return an empty string when no name is available', () => {
      expect(getFileExtension()).toBe('')
    })
  })

  describe('getFileIconType', () => {
    it('should resolve media, document, and database icon types', () => {
      expect(getFileIconType('cover.png')).toBe(FileAppearanceTypeEnum.image)
      expect(getFileIconType('anim.gif')).toBe(FileAppearanceTypeEnum.image)
      expect(getFileIconType('clip.mp4')).toBe(FileAppearanceTypeEnum.video)
      expect(getFileIconType('podcast.mp3')).toBe(FileAppearanceTypeEnum.audio)
      expect(getFileIconType('notes.md')).toBe(FileAppearanceTypeEnum.markdown)
      expect(getFileIconType('report.docx')).toBe(FileAppearanceTypeEnum.word)
      expect(getFileIconType('schema.ts')).toBe(FileAppearanceTypeEnum.code)
      expect(getFileIconType('sheet.xlsx')).toBe(FileAppearanceTypeEnum.excel)
      expect(getFileIconType('slides.pptx')).toBe(FileAppearanceTypeEnum.ppt)
      expect(getFileIconType('data.sqlite')).toBe(FileAppearanceTypeEnum.database)
      expect(getFileIconType('unknown.bin')).toBe(FileAppearanceTypeEnum.document)
    })

    it('should let the explicit extension override the file name', () => {
      expect(getFileIconType('README', '.pdf')).toBe(FileAppearanceTypeEnum.pdf)
    })
  })

  describe('type guards', () => {
    it('should classify markdown, image, video, sqlite, pdf, and binary files', () => {
      expect(isMarkdownFile('mdx')).toBe(true)
      expect(isImageFile('svg')).toBe(true)
      expect(isVideoFile('webm')).toBe(true)
      expect(isSQLiteFile('sqlite3')).toBe(true)
      expect(isPdfFile('pdf')).toBe(true)
      expect(isBinaryFile('docx')).toBe(true)
    })

    it('should detect text-like files by excluding binary and preview-only formats', () => {
      expect(isTextLikeFile('ts')).toBe(true)
      expect(isTextLikeFile('svg')).toBe(false)
      expect(isTextLikeFile('mp4')).toBe(false)
      expect(isTextLikeFile('pdf')).toBe(false)
      expect(isTextLikeFile('zip')).toBe(false)
    })
  })

  describe('getFileLanguage', () => {
    it('should map supported extensions to editor languages', () => {
      expect(getFileLanguage('index.tsx')).toBe('typescript')
      expect(getFileLanguage('config.yml')).toBe('yaml')
      expect(getFileLanguage('script.sh')).toBe('shell')
      expect(getFileLanguage('template.html')).toBe('html')
      expect(getFileLanguage('query.sql')).toBe('sql')
    })

    it('should fall back to plaintext for unknown extensions', () => {
      expect(getFileLanguage('LICENSE')).toBe('plaintext')
    })
  })
})
