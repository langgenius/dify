import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import LocaleMenu from '../_locale-menu'

const localeItems = [
  { value: 'en-US', name: 'English (US)' },
  { value: 'zh-Hans', name: '简体中文' },
  { value: 'ja-JP', name: '日本語' },
]

describe('LocaleMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render selected locale name when value matches an item', () => {
      render(
        <LocaleMenu
          items={localeItems}
          value="en-US"
          onChange={vi.fn()}
        />,
      )

      expect(screen.getByRole('button', { name: /english \(us\)/i })).toBeInTheDocument()
    })

    it('should render trigger without selected label when value is not found', () => {
      render(
        <LocaleMenu
          items={localeItems}
          value="missing"
          onChange={vi.fn()}
        />,
      )

      const trigger = screen.getByRole('button')
      expect(trigger).toBeInTheDocument()
      expect(trigger).not.toHaveTextContent('English (US)')
    })
  })

  describe('User Interactions', () => {
    it('should call onChange with selected locale value when clicking an option', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()

      render(
        <LocaleMenu
          items={localeItems}
          value="en-US"
          onChange={onChange}
        />,
      )

      await user.click(screen.getByRole('button', { name: /english \(us\)/i }))
      await user.click(screen.getByRole('menuitemradio', { name: '日本語' }))

      expect(onChange).toHaveBeenCalledWith('ja-JP')
    })

    it('should render all locale options when menu is opened', async () => {
      const user = userEvent.setup()

      render(
        <LocaleMenu
          items={localeItems}
          value="en-US"
          onChange={vi.fn()}
        />,
      )

      await user.click(screen.getByRole('button', { name: /english \(us\)/i }))

      expect(screen.getByRole('menuitemradio', { name: 'English (US)' })).toBeInTheDocument()
      expect(screen.getByRole('menuitemradio', { name: '简体中文' })).toBeInTheDocument()
      expect(screen.getByRole('menuitemradio', { name: '日本語' })).toBeInTheDocument()
    })
  })

  describe('Edge Cases', () => {
    it('should not throw when onChange is undefined and option is selected', async () => {
      const user = userEvent.setup()

      render(
        <LocaleMenu
          items={localeItems}
          value="en-US"
        />,
      )

      await user.click(screen.getByRole('button', { name: /english \(us\)/i }))
      await user.click(screen.getByRole('menuitemradio', { name: '简体中文' }))

      expect(screen.queryByRole('menuitemradio', { name: '简体中文' })).not.toBeInTheDocument()
    })

    it('should render no options when items are empty', async () => {
      const user = userEvent.setup()

      render(
        <LocaleMenu
          items={[]}
          value="en-US"
          onChange={vi.fn()}
        />,
      )

      await user.click(screen.getByRole('button'))

      expect(screen.queryAllByRole('menuitemradio')).toHaveLength(0)
    })
  })
})
