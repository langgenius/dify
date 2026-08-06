import { render, screen } from '@testing-library/react'
import { MediaType } from '@/hooks/use-breakpoints'
import Explore from '../index'

type MediaTypeValue = (typeof MediaType)[keyof typeof MediaType]

let mockMediaType: MediaTypeValue = MediaType.pc

vi.mock('@/hooks/use-breakpoints', () => ({
  default: () => mockMediaType,
  MediaType: {
    mobile: 'mobile',
    tablet: 'tablet',
    pc: 'pc',
  },
}))

vi.mock('@/app/components/explore/sidebar', () => ({
  default: () => <aside aria-label="explore.sidebar.title" />,
}))

describe('Explore', () => {
  beforeEach(() => {
    mockMediaType = MediaType.pc
  })

  describe('Rendering', () => {
    it('should render children', () => {
      render(
        <Explore>
          <div>child</div>
        </Explore>,
      )

      expect(screen.getByText('child')).toBeInTheDocument()
    })

    it('should not render the legacy explore sidebar on desktop', () => {
      render(
        <Explore>
          <div>child</div>
        </Explore>,
      )

      expect(
        screen.queryByRole('complementary', { name: 'explore.sidebar.title' }),
      ).not.toBeInTheDocument()
    })

    it('should keep the legacy explore sidebar on mobile', () => {
      mockMediaType = MediaType.mobile

      render(
        <Explore>
          <div>child</div>
        </Explore>,
      )

      expect(
        screen.getByRole('complementary', { name: 'explore.sidebar.title' }),
      ).toBeInTheDocument()
    })
  })
})
