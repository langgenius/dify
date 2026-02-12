import type { Template } from '../types'
import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import TemplateCard from './template-card'

// Mock AppIcon component to capture props for assertion
vi.mock('@/app/components/base/app-icon', () => ({
  default: ({ size, iconType, icon, imageUrl, background }: {
    size?: string
    iconType?: string
    icon?: string
    imageUrl?: string | null
    background?: string | null
  }) => (
    <span
      data-testid="app-icon"
      data-size={size}
      data-icon-type={iconType}
      data-icon={icon}
      data-image-url={imageUrl || ''}
      data-background={background || ''}
    />
  ),
}))

// Mock i18n
vi.mock('#i18n', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      if (key === 'marketplace.templateCard.by')
        return `by ${options?.author || ''}`
      if (key === 'usedCount')
        return `${options?.num || 0} used`
      return key
    },
  }),
  useLocale: () => 'en-US',
}))

// Mock next/link
vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: { children: React.ReactNode, href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}))

// Mock next-themes
vi.mock('next-themes', () => ({
  useTheme: () => ({ theme: 'light' }),
}))

// Mock marketplace utils
vi.mock('@/utils/get-icon', () => ({
  getIconFromMarketPlace: (id: string) => `https://marketplace.dify.ai/api/v1/plugins/${id}/icon`,
}))

vi.mock('@/utils/template', () => ({
  formatUsedCount: (count: number) => String(count),
}))

vi.mock('@/utils/var', () => ({
  getMarketplaceUrl: (path: string) => `https://marketplace.dify.ai${path}`,
}))

vi.mock('@/app/components/plugins/card/base/corner-mark', () => ({
  default: ({ text }: { text: string }) => <span data-testid="corner-mark">{text}</span>,
}))

// Mock marketplace utils (getTemplateIconUrl)
vi.mock('../utils', () => ({
  getTemplateIconUrl: (template: { id: string, icon?: string, icon_file_key?: string }): string => {
    if (template.icon?.startsWith('http'))
      return template.icon
    if (template.icon_file_key)
      return `https://marketplace.dify.ai/api/v1/templates/${template.id}/icon`
    return ''
  },
}))

// ================================
// Test Data Factories
// ================================

const createMockTemplate = (overrides?: Partial<Template>): Template => ({
  id: 'test-template-id',
  index_id: 'test-template-id',
  template_name: 'test-template',
  icon: '📄',
  icon_background: '',
  icon_file_key: '',
  categories: ['Agent'],
  overview: 'A test template',
  readme: 'readme content',
  partner_link: '',
  deps_plugins: [],
  preferred_languages: ['en'],
  publisher_handle: 'test-publisher',
  publisher_type: 'individual',
  kind: 'classic',
  status: 'published',
  usage_count: 100,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  ...overrides,
})

// ================================
// Tests
// ================================

describe('TemplateCard', () => {
  describe('Icon Rendering via AppIcon', () => {
    it('should pass emoji id to AppIcon when icon is an emoji id like sweat_smile', () => {
      const template = createMockTemplate({ icon: 'sweat_smile' })
      const { container } = render(<TemplateCard template={template} />)

      const appIcon = container.querySelector('[data-testid="app-icon"]')
      expect(appIcon).toBeInTheDocument()
      expect(appIcon?.getAttribute('data-icon-type')).toBe('emoji')
      expect(appIcon?.getAttribute('data-icon')).toBe('sweat_smile')
      expect(appIcon?.getAttribute('data-size')).toBe('large')
    })

    it('should pass unicode emoji to AppIcon when icon is a unicode character', () => {
      const template = createMockTemplate({ icon: '😅' })
      const { container } = render(<TemplateCard template={template} />)

      const appIcon = container.querySelector('[data-testid="app-icon"]')
      expect(appIcon).toBeInTheDocument()
      expect(appIcon?.getAttribute('data-icon-type')).toBe('emoji')
      expect(appIcon?.getAttribute('data-icon')).toBe('😅')
    })

    it('should pass default fallback icon to AppIcon when icon and icon_file_key are both empty', () => {
      const template = createMockTemplate({ icon: '', icon_file_key: '' })
      const { container } = render(<TemplateCard template={template} />)

      const appIcon = container.querySelector('[data-testid="app-icon"]')
      expect(appIcon).toBeInTheDocument()
      expect(appIcon?.getAttribute('data-icon-type')).toBe('emoji')
      expect(appIcon?.getAttribute('data-icon')).toBe('📄')
    })

    it('should pass image URL to AppIcon when icon is a URL', () => {
      const template = createMockTemplate({ icon: 'https://example.com/icon.png' })
      const { container } = render(<TemplateCard template={template} />)

      const appIcon = container.querySelector('[data-testid="app-icon"]')
      expect(appIcon).toBeInTheDocument()
      expect(appIcon?.getAttribute('data-icon-type')).toBe('image')
      expect(appIcon?.getAttribute('data-image-url')).toBe('https://example.com/icon.png')
      // icon prop should not be set for URL icons
      expect(appIcon?.hasAttribute('data-icon')).toBe(false)
    })

    it('should resolve image URL from icon_file_key when icon is empty but icon_file_key is set', () => {
      const template = createMockTemplate({
        id: 'tpl-123',
        icon: '',
        icon_file_key: 'fa3b0f86-bc64-47ec-ad83-8e3cfc6739ae.jpg',
      })
      const { container } = render(<TemplateCard template={template} />)

      const appIcon = container.querySelector('[data-testid="app-icon"]')
      expect(appIcon).toBeInTheDocument()
      expect(appIcon?.getAttribute('data-icon-type')).toBe('image')
      expect(appIcon?.getAttribute('data-image-url')).toBe('https://marketplace.dify.ai/api/v1/templates/tpl-123/icon')
      // icon prop should not be set when rendering as image
      expect(appIcon?.hasAttribute('data-icon')).toBe(false)
    })

    it('should prefer icon URL over icon_file_key when both are present', () => {
      const template = createMockTemplate({
        icon: 'https://example.com/custom-icon.png',
        icon_file_key: 'fa3b0f86-bc64-47ec-ad83-8e3cfc6739ae.jpg',
      })
      const { container } = render(<TemplateCard template={template} />)

      const appIcon = container.querySelector('[data-testid="app-icon"]')
      expect(appIcon?.getAttribute('data-icon-type')).toBe('image')
      expect(appIcon?.getAttribute('data-image-url')).toBe('https://example.com/custom-icon.png')
    })
  })

  describe('Avatar Background', () => {
    it('should pass icon_background to AppIcon when provided', () => {
      const template = createMockTemplate({ icon: 'sweat_smile', icon_background: '#FFEAD5' })
      const { container } = render(<TemplateCard template={template} />)

      const appIcon = container.querySelector('[data-testid="app-icon"]')
      expect(appIcon?.getAttribute('data-background')).toBe('#FFEAD5')
    })

    it('should not pass background to AppIcon when icon_background is empty', () => {
      const template = createMockTemplate({ icon: 'sweat_smile', icon_background: '' })
      const { container } = render(<TemplateCard template={template} />)

      const appIcon = container.querySelector('[data-testid="app-icon"]')
      // Empty string means no background was passed (undefined becomes '')
      expect(appIcon?.getAttribute('data-background')).toBe('')
    })
  })

  describe('Sandbox', () => {
    it('should render CornerMark when kind is sandboxed', () => {
      const template = createMockTemplate({ kind: 'sandboxed' })
      const { container } = render(<TemplateCard template={template} />)

      const cornerMark = container.querySelector('[data-testid="corner-mark"]')
      expect(cornerMark).toBeInTheDocument()
      expect(cornerMark?.textContent).toBe('Sandbox')
    })

    it('should not render CornerMark when kind is classic', () => {
      const template = createMockTemplate({ kind: 'classic' })
      const { container } = render(<TemplateCard template={template} />)

      const cornerMark = container.querySelector('[data-testid="corner-mark"]')
      expect(cornerMark).not.toBeInTheDocument()
    })
  })

  describe('Creator Link', () => {
    it('should append publisher_type query to creator link', () => {
      const template = createMockTemplate({ publisher_type: 'organization' })
      const { getByText } = render(<TemplateCard template={template} />)

      const creatorLink = getByText('test-publisher').closest('a')
      expect(creatorLink).toHaveAttribute('href', '/creator/test-publisher?publisher_type=organization')
    })
  })

  describe('Deps Plugins', () => {
    it('should render dep plugin icons', () => {
      const template = createMockTemplate({
        deps_plugins: ['langgenius/google-search', 'langgenius/dalle'],
      })
      const { container } = render(<TemplateCard template={template} />)

      const pluginIcons = container.querySelectorAll('.h-6.w-6 img')
      expect(pluginIcons.length).toBe(2)
    })

    it('should show +N when deps_plugins exceed MAX_VISIBLE_DEPS_PLUGINS', () => {
      const deps = Array.from({ length: 10 }, (_, i) => `org/plugin-${i}`)
      const template = createMockTemplate({ deps_plugins: deps })
      const { container } = render(<TemplateCard template={template} />)

      // Should show 7 visible + "+3"
      const pluginIcons = container.querySelectorAll('.h-6.w-6 img')
      expect(pluginIcons.length).toBe(7)

      expect(container.textContent).toContain('+3')
    })
  })
})
