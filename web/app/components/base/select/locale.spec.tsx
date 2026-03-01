import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import LocaleSelect from './locale'

const localeItems = [
  { value: 'en-US', name: 'English (US)' },
  { value: 'zh-Hans', name: '简体中文' },
  { value: 'ja-JP', name: '日本語' },
]

describe('LocaleSelect', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Rendering behavior for selected value and fallback state.
  describe('Rendering', () => {
    it('should render selected locale name when value matches an item', () => {
      render(
        <LocaleSelect
          items={localeItems}
          value="en-US"
          onChange={vi.fn()}
        />,
      )

      expect(screen.getByRole('button', { name: /english \(us\)/i })).toBeInTheDocument()
    })

    it('should render trigger without selected label when value is not found', () => {
      render(
        <LocaleSelect
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

  // Menu interactions and callback behavior.
  describe('User Interactions', () => {
    it('should call onChange with selected locale value when clicking an option', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()

      render(
        <LocaleSelect
          items={localeItems}
          value="en-US"
          onChange={onChange}
        />,
      )

      await user.click(screen.getByRole('button', { name: /english \(us\)/i }))
      await user.click(screen.getByRole('menuitem', { name: '日本語' }))

      expect(onChange).toHaveBeenCalledWith('ja-JP')
    })

    it('should render all locale options when menu is opened', async () => {
      const user = userEvent.setup()

      render(
        <LocaleSelect
          items={localeItems}
          value="en-US"
          onChange={vi.fn()}
        />,
      )

      await user.click(screen.getByRole('button', { name: /english \(us\)/i }))

      expect(screen.getByRole('menuitem', { name: 'English (US)' })).toBeInTheDocument()
      expect(screen.getByRole('menuitem', { name: '简体中文' })).toBeInTheDocument()
      expect(screen.getByRole('menuitem', { name: '日本語' })).toBeInTheDocument()
    })
  })

  // Edge behavior for missing callback and empty data.
  describe('Edge Cases', () => {
    it('should not throw when onChange is undefined and option is selected', async () => {
      const user = userEvent.setup()

      render(
        <LocaleSelect
          items={localeItems}
          value="en-US"
        />,
      )

      await user.click(screen.getByRole('button', { name: /english \(us\)/i }))
      await user.click(screen.getByRole('menuitem', { name: '简体中文' }))
    })

    it('should render no options when items are empty', async () => {
      const user = userEvent.setup()

      render(
        <LocaleSelect
          items={[]}
          value="en-US"
          onChange={vi.fn()}
        />,
      )

      await user.click(screen.getByRole('button'))
      expect(screen.queryAllByRole('menuitem')).toHaveLength(0)
    })
  })
})
