import type { FileAppearanceTypeEnum } from './types'
import { render } from '@testing-library/react'
import FileTypeIcon from './file-type-icon'

describe('FileTypeIcon', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('icon rendering per file type', () => {
    const fileTypeToColor: Array<{ type: keyof typeof FileAppearanceTypeEnum, color: string }> = [
      { type: 'pdf', color: 'text-[#EA3434]' },
      { type: 'image', color: 'text-[#00B2EA]' },
      { type: 'video', color: 'text-[#844FDA]' },
      { type: 'audio', color: 'text-[#FF3093]' },
      { type: 'document', color: 'text-[#6F8BB5]' },
      { type: 'code', color: 'text-[#BCC0D1]' },
      { type: 'markdown', color: 'text-[#309BEC]' },
      { type: 'custom', color: 'text-[#BCC0D1]' },
      { type: 'excel', color: 'text-[#01AC49]' },
      { type: 'word', color: 'text-[#2684FF]' },
      { type: 'ppt', color: 'text-[#FF650F]' },
      { type: 'gif', color: 'text-[#00B2EA]' },
    ]

    it.each(fileTypeToColor)(
      'should render $type icon with correct color',
      ({ type, color }) => {
        const { container } = render(<FileTypeIcon type={type} />)

        const icon = container.querySelector('svg')
        expect(icon).toBeInTheDocument()
        expect(icon).toHaveClass(color)
      },
    )
  })

  it('should render document icon when type is unknown', () => {
    const { container } = render(<FileTypeIcon type={'nonexistent' as unknown as keyof typeof FileAppearanceTypeEnum} />)

    const icon = container.querySelector('svg')
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
        const { container } = render(<FileTypeIcon type="pdf" size={size} />)

        const icon = container.querySelector('svg')
        expect(icon).toHaveClass(expectedClass)
      },
    )

    it('should default to sm size when no size is provided', () => {
      const { container } = render(<FileTypeIcon type="pdf" />)

      const icon = container.querySelector('svg')
      expect(icon).toHaveClass('size-4')
    })
  })

  it('should apply custom className when provided', () => {
    const { container } = render(<FileTypeIcon type="pdf" className="extra-class" />)

    const icon = container.querySelector('svg')
    expect(icon).toHaveClass('extra-class')
  })

  it('should always include shrink-0 class', () => {
    const { container } = render(<FileTypeIcon type="document" />)

    const icon = container.querySelector('svg')
    expect(icon).toHaveClass('shrink-0')
  })
})
