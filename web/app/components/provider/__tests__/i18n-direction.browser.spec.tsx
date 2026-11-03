import { Tabs, TabsList, TabsTab } from '@langgenius/dify-ui/tabs'
import Cookies from 'js-cookie'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import {
  DatePicker,
  DatePickerContent,
  DatePickerLabel,
  DatePickerTrigger,
} from '@/app/components/base/date-time-picker/date-picker'
import { I18nClientProvider } from '@/app/components/provider/i18n'
import { LOCALE_COOKIE_NAME } from '@/config'
import { setLocaleOnClient } from '@/i18n/client'
import arTime from '@/i18n/locales/ar-TN/time.json'
import enTime from '@/i18n/locales/en-US/time.json'

vi.mock('react-i18next', async (importOriginal) => await importOriginal())
vi.mock('@/next/navigation', () => ({ useServerInsertedHTML: () => {} }))

function LanguageControls() {
  return (
    <>
      <button onClick={() => void setLocaleOnClient('ar-TN')}>Arabic</button>
      <button onClick={() => void setLocaleOnClient('en-US')}>English</button>
    </>
  )
}

it('keeps document layout, keyboard navigation and portaled pickers aligned when language changes', async () => {
  const { lang, dir } = document.documentElement
  const savedLocale = Cookies.get(LOCALE_COOKIE_NAME)
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
    await second.click()
    await screen.getByRole('button', { name: 'Arabic' }).click()
    await expect.poll(() => document.documentElement.lang).toBe('ar-TN')
    expect(document.documentElement.dir).toBe('rtl')
    expect(Cookies.get(LOCALE_COOKIE_NAME)).toBe('ar-TN')
    await expect.element(second).toHaveAttribute('aria-selected', 'true')
    expect(second.element().getBoundingClientRect().left).toBeLessThan(
      first.element().getBoundingClientRect().left,
    )
    await first.click()
    await userEvent.keyboard('{ArrowLeft}')
    await expect.element(second).toHaveFocus()
    await screen.getByRole('button', { name: /^Date / }).click()
    await expect.element(page.getByRole('dialog')).toBeVisible()
    expect(getComputedStyle(page.getByRole('dialog').element()).direction).toBe('rtl')
    await userEvent.keyboard('{Escape}')
    await second.click()
    await screen.getByRole('button', { name: 'English' }).click()
    await expect.poll(() => document.documentElement.lang).toBe('en-US')
    expect(document.documentElement.dir).toBe('ltr')
    expect(Cookies.get(LOCALE_COOKIE_NAME)).toBe('en-US')
    await expect.element(second).toHaveAttribute('aria-selected', 'true')
    expect(second.element().getBoundingClientRect().left).toBeGreaterThan(
      first.element().getBoundingClientRect().left,
    )
    await first.click()
    await userEvent.keyboard('{ArrowRight}')
    await expect.element(second).toHaveFocus()
  } finally {
    document.documentElement.lang = lang
    document.documentElement.dir = dir
    if (savedLocale === undefined) Cookies.remove(LOCALE_COOKIE_NAME)
    else Cookies.set(LOCALE_COOKIE_NAME, savedLocale)
  }
})
