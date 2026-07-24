import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import DatasourceIcon from '../datasource-icon'

describe('DatasourceIcon', () => {
  it('should render icon with background image', () => {
    const { container } = render(<DatasourceIcon iconUrl="https://example.com/icon.png" />)
    const iconDiv = container.querySelector('[style*="background-image"]')
    expect(iconDiv).not.toBeNull()
    expect(iconDiv?.getAttribute('style')).toContain('https://example.com/icon.png')
  })

  it('should apply size class for sm', () => {
    const { container } = render(<DatasourceIcon iconUrl="/icon.png" size="sm" />)
    const wrapper = container.firstChild as HTMLElement
    expect(wrapper.className).toContain('w-5')
    expect(wrapper.className).toContain('h-5')
  })

  it('should apply size class for md', () => {
    const { container } = render(<DatasourceIcon iconUrl="/icon.png" size="md" />)
    const wrapper = container.firstChild as HTMLElement
    expect(wrapper.className).toContain('w-6')
    expect(wrapper.className).toContain('h-6')
  })

  it('should apply size class for xs', () => {
    const { container } = render(<DatasourceIcon iconUrl="/icon.png" size="xs" />)
    const wrapper = container.firstChild as HTMLElement
    expect(wrapper.className).toContain('w-4')
    expect(wrapper.className).toContain('h-4')
  })
})
