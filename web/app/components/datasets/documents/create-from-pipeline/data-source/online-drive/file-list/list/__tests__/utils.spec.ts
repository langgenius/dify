import { describe, expect, it } from 'vitest'
import { FileAppearanceTypeEnum } from '@/app/components/base/file-uploader/types'
import { getFileExtension, getFileType } from '../utils'

describe('getFileExtension', () => {
  it('should return extension for normal file', () => {
    expect(getFileExtension('test.pdf')).toBe('pdf')
  })

  it('should return lowercase extension', () => {
    expect(getFileExtension('test.PDF')).toBe('pdf')
  })

  it('should return last extension for multiple dots', () => {
    expect(getFileExtension('my.file.name.txt')).toBe('txt')
  })

  it('should return empty string for no extension', () => {
    expect(getFileExtension('noext')).toBe('')
  })

  it('should return empty string for empty string', () => {
    expect(getFileExtension('')).toBe('')
  })

  it('should return empty string for dotfile with no extension', () => {
    expect(getFileExtension('.gitignore')).toBe('')
  })
})

describe('getFileType', () => {
  it('should return pdf for .pdf files', () => {
    expect(getFileType('doc.pdf')).toBe(FileAppearanceTypeEnum.pdf)
  })

  it('should return markdown for .md files', () => {
    expect(getFileType('readme.md')).toBe(FileAppearanceTypeEnum.markdown)
  })

  it('should return markdown for .mdx files', () => {
    expect(getFileType('page.mdx')).toBe(FileAppearanceTypeEnum.markdown)
  })

  it('should return excel for .xlsx files', () => {
    expect(getFileType('data.xlsx')).toBe(FileAppearanceTypeEnum.excel)
  })

  it('should return excel for .csv files', () => {
    expect(getFileType('data.csv')).toBe(FileAppearanceTypeEnum.excel)
  })

  it('should return word for .docx files', () => {
    expect(getFileType('doc.docx')).toBe(FileAppearanceTypeEnum.word)
  })

  it('should return ppt for .pptx files', () => {
    expect(getFileType('slides.pptx')).toBe(FileAppearanceTypeEnum.ppt)
  })

  it('should return code for .html files', () => {
    expect(getFileType('page.html')).toBe(FileAppearanceTypeEnum.code)
  })

  it('should return code for .json files', () => {
    expect(getFileType('config.json')).toBe(FileAppearanceTypeEnum.code)
  })

  it('should return gif for .gif files', () => {
    expect(getFileType('animation.gif')).toBe(FileAppearanceTypeEnum.gif)
  })

  it('should return custom for unknown extension', () => {
    expect(getFileType('file.xyz')).toBe(FileAppearanceTypeEnum.custom)
  })

  it('should return custom for no extension', () => {
    expect(getFileType('noext')).toBe(FileAppearanceTypeEnum.custom)
  })
})
