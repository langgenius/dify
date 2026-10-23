import { Tabs, TabsList, TabsTab } from '@langgenius/dify-ui/tabs'
import { useTranslation } from 'react-i18next'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import {
  DatePicker,
  DatePickerContent,
  DatePickerLabel,
  DatePickerTrigger,
} from '@/app/components/base/date-time-picker/date-picker'
import { I18nClientProvider } from '@/app/components/provider/i18n'
import arTime from '@/i18n/locales/ar-TN/time.json'
import enTime from '@/i18n/locales/en-US/time.json'

vi.mock('react-i18next', async (importOriginal) => await importOriginal())
vi.mock('@/next/navigation', () => ({ useServerInsertedHTML: () => {} }))

function LanguageControls() {
  const { i18n } = useTranslation([])
  return (
    <>
      <button onClick={() => void i18n.changeLanguage('ar-TN')}>Arabic</button>
      <button onClick={() => void i18n.changeLanguage('en-US')}>English</button>
    </>
  )
}

it('keeps document layout, keyboard navigation and portaled pickers aligned when language changes', async () => {
  const { lang, dir } = document.documentElement
  const screen = await render(
    <I18nClientProvider
      locale="en-US"
      resource={{ 'en-US': { time: enTime }, 'ar-TN': { time: arTime } }}
    >
      <LanguageControls />
      <Tabs defaultValue="first">
        <TabsList aria-label="Sections">
          <TabsTab value="first">First</TabsTab>
          <TabsTab value="second">Second</TabsTab>
          <TabsTab value="third">Third</TabsTab>
        </TabsList>
      </Tabs>
      <DatePicker defaultValue="2025-01-15">
        <DatePickerLabel>Date</DatePickerLabel>
        <DatePickerTrigger />
        <DatePickerContent />
      </DatePicker>
    </I18nClientProvider>,
  )
  try {
    const first = screen.getByRole('tab', { name: 'First' })
    const second = screen.getByRole('tab', { name: 'Second' })
    await screen.getByRole('button', { name: 'Arabic' }).click()
    await expect.poll(() => document.documentElement.lang).toBe('ar-TN')
    expect(document.documentElement.dir).toBe('rtl')
    expect(second.element().getBoundingClientRect().left).toBeLessThan(
      first.element().getBoundingClientRect().left,
    )
    await first.click()
    await userEvent.keyboard('{ArrowLeft}')
    await expect.element(second).toHaveFocus()
    await screen.getByRole('button', { name: /^Date / }).click()
    await expect.element(page.getByRole('dialog')).toHaveAttribute('dir', 'rtl')
    await userEvent.keyboard('{Escape}')
    await screen.getByRole('button', { name: 'English' }).click()
    await expect.poll(() => document.documentElement.lang).toBe('en-US')
    expect(document.documentElement.dir).toBe('ltr')
    expect(second.element().getBoundingClientRect().left).toBeGreaterThan(
      first.element().getBoundingClientRect().left,
    )
    await first.click()
    await userEvent.keyboard('{ArrowRight}')
    await expect.element(second).toHaveFocus()
  } finally {
    document.documentElement.lang = lang
    document.documentElement.dir = dir
  }
})
