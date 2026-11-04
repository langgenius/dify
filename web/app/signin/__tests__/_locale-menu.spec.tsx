import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import LocaleMenu from '../_locale-menu'

const localeItems = [
  { value: 'en-US', name: 'English (US)' },
  { value: 'zh-Hans', name: '简体中文' },
  { value: 'ja-JP', name: '日本語' },
]

describe('LocaleMenu', () => {
  describe('User Interactions', () => {
    it('should call onChange with selected locale value when clicking an option', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()

      render(<LocaleMenu items={localeItems} value="en-US" onChange={onChange} />)

      await user.click(screen.getByRole('button', { name: /english \(us\)/i }))
      await user.click(screen.getByRole('menuitemradio', { name: '日本語' }))

      expect(onChange).toHaveBeenCalledWith('ja-JP')
    })
  })
})
