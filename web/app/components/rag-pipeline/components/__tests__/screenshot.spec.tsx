import { render, screen } from '@testing-library/react'
import PipelineScreenShot from '../screenshot'

vi.mock('@/hooks/use-theme', () => ({
  default: () => ({
    theme: 'dark',
  }),
}))

vi.mock('@/utils/var', () => ({
  basePath: '/console',
}))

describe('PipelineScreenShot', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should build themed screenshot sources', () => {
    const { container } = render(<PipelineScreenShot />)
    const sources = container.querySelectorAll('source')

    expect(sources).toHaveLength(3)
    expect(sources[0]).toHaveAttribute('srcset', '/console/screenshots/dark/Pipeline.png')
    expect(sources[1]).toHaveAttribute('srcset', '/console/screenshots/dark/Pipeline@2x.png')
    expect(sources[2]).toHaveAttribute('srcset', '/console/screenshots/dark/Pipeline@3x.png')
    expect(screen.getByAltText('Pipeline Screenshot')).toHaveAttribute('src', '/console/screenshots/dark/Pipeline.png')
  })
})
