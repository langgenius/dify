import type { FileAppearanceTypeEnum } from './types'
import { render, screen } from '@testing-library/react'
import FileTypeIcon from './file-type-icon'

vi.mock('@remixicon/react', () => ({
  RiFilePdf2Fill: ({ className }: { className?: string }) => (
    <svg data-testid="icon-pdf" className={className} />
  ),
  RiFileImageFill: ({ className }: { className?: string }) => (
    <svg data-testid="icon-image" className={className} />
  ),
  RiFileVideoFill: ({ className }: { className?: string }) => (
    <svg data-testid="icon-video" className={className} />
  ),
  RiFileMusicFill: ({ className }: { className?: string }) => (
    <svg data-testid="icon-audio" className={className} />
  ),
  RiFileTextFill: ({ className }: { className?: string }) => (
    <svg data-testid="icon-document" className={className} />
  ),
  RiFileCodeFill: ({ className }: { className?: string }) => (
    <svg data-testid="icon-code" className={className} />
  ),
  RiMarkdownFill: ({ className }: { className?: string }) => (
    <svg data-testid="icon-markdown" className={className} />
  ),
  RiFile3Fill: ({ className }: { className?: string }) => (
    <svg data-testid="icon-custom" className={className} />
  ),
  RiFileExcelFill: ({ className }: { className?: string }) => (
    <svg data-testid="icon-excel" className={className} />
  ),
  RiFileWordFill: ({ className }: { className?: string }) => (
    <svg data-testid="icon-word" className={className} />
  ),
  RiFilePpt2Fill: ({ className }: { className?: string }) => (
    <svg data-testid="icon-ppt" className={className} />
  ),
  RiFileGifFill: ({ className }: { className?: string }) => (
    <svg data-testid="icon-gif" className={className} />
  ),
}))

describe('FileTypeIcon', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('icon rendering per file type', () => {
    const fileTypeToTestId: Array<{ type: keyof typeof FileAppearanceTypeEnum, testId: string, color: string }> = [
      { type: 'pdf', testId: 'icon-pdf', color: 'text-[#EA3434]' },
      { type: 'image', testId: 'icon-image', color: 'text-[#00B2EA]' },
      { type: 'video', testId: 'icon-video', color: 'text-[#844FDA]' },
      { type: 'audio', testId: 'icon-audio', color: 'text-[#FF3093]' },
      { type: 'document', testId: 'icon-document', color: 'text-[#6F8BB5]' },
      { type: 'code', testId: 'icon-code', color: 'text-[#BCC0D1]' },
      { type: 'markdown', testId: 'icon-markdown', color: 'text-[#309BEC]' },
      { type: 'custom', testId: 'icon-custom', color: 'text-[#BCC0D1]' },
      { type: 'excel', testId: 'icon-excel', color: 'text-[#01AC49]' },
      { type: 'word', testId: 'icon-word', color: 'text-[#2684FF]' },
      { type: 'ppt', testId: 'icon-ppt', color: 'text-[#FF650F]' },
      { type: 'gif', testId: 'icon-gif', color: 'text-[#00B2EA]' },
    ]

    it.each(fileTypeToTestId)(
      'should render $type icon with correct color',
      ({ type, testId, color }) => {
        render(<FileTypeIcon type={type} />)

        const icon = screen.getByTestId(testId)
        expect(icon).toBeInTheDocument()
        expect(icon).toHaveClass(color)
      },
    )
  })

  it('should render document icon when type is unknown', () => {
    render(<FileTypeIcon type={'nonexistent' as unknown as keyof typeof FileAppearanceTypeEnum} />)

    const icon = screen.getByTestId('icon-document')
    expect(icon).toBeInTheDocument()
    expect(icon).toHaveClass('text-[#6F8BB5]')
  })

  describe('size variants', () => {
    const sizeMap: Array<{ size: 'sm' | 'md' | 'lg' | 'xl', expectedClass: string }> = [
      { size: 'sm', expectedClass: 'size-4' },
      { size: 'md', expectedClass: 'size-[18px]' },
      { size: 'lg', expectedClass: 'size-5' },
      { size: 'xl', expectedClass: 'size-6' },
    ]

    it.each(sizeMap)(
      'should apply $expectedClass when size is $size',
      ({ size, expectedClass }) => {
        render(<FileTypeIcon type="pdf" size={size} />)

        const icon = screen.getByTestId('icon-pdf')
        expect(icon).toHaveClass(expectedClass)
      },
    )

    it('should default to sm size when no size is provided', () => {
      render(<FileTypeIcon type="pdf" />)

      const icon = screen.getByTestId('icon-pdf')
      expect(icon).toHaveClass('size-4')
    })
  })

  it('should apply custom className when provided', () => {
    render(<FileTypeIcon type="pdf" className="extra-class" />)

    const icon = screen.getByTestId('icon-pdf')
    expect(icon).toHaveClass('extra-class')
  })

  it('should always include shrink-0 class', () => {
    render(<FileTypeIcon type="document" />)

    const icon = screen.getByTestId('icon-document')
    expect(icon).toHaveClass('shrink-0')
  })
})
