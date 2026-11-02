import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { languages } from '@/i18n/language'
import LanguageSelect from '../index'

it('offers only supported prompt languages and applies the selected name', async () => {
  const user = userEvent.setup()
  const Harness = () => {
    const [language, setLanguage] = useState('English')
    return <LanguageSelect currentLanguage={language} onSelect={setLanguage} />
  }
  render(<Harness />)
  const trigger = screen.getByRole('combobox', { name: 'language' })
  expect(trigger).toHaveTextContent('English')
  await user.click(trigger)
  const list = await screen.findByRole('listbox')
  expect(
    within(list)
      .getAllByRole('option')
      .map((option) => option.textContent),
  ).toEqual(
    languages.filter((language) => language.supported).map((language) => language.prompt_name),
  )
  await user.click(within(list).getByRole('option', { name: 'French' }))
  expect(trigger).toHaveTextContent('French')
})

it('prevents changing the language when disabled', async () => {
  const user = userEvent.setup()
  const onSelect = vi.fn()
  render(<LanguageSelect currentLanguage="English" onSelect={onSelect} disabled />)
  const trigger = screen.getByRole('combobox', { name: 'language' })
  expect(trigger).toBeDisabled()
  await user.click(trigger)
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  expect(onSelect).not.toHaveBeenCalled()
})
