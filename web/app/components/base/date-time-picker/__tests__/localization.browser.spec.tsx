import { createInstance } from 'i18next'
import { useState } from 'react'
import { I18nextProvider } from 'react-i18next'
import { page, userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import {
  DatePicker,
  DatePickerContent,
  DatePickerLabel,
  DatePickerTrigger,
} from '@/app/components/base/date-time-picker/date-picker'
import {
  DateTimePicker,
  DateTimePickerLabel,
  DateTimePickerTrigger,
} from '@/app/components/base/date-time-picker/date-time-picker'
import {
  TimePicker,
  TimePickerContent,
  TimePickerLabel,
  TimePickerTrigger,
} from '@/app/components/base/date-time-picker/time-picker'
import { I18nDirectionProvider } from '@/app/components/provider/i18n-direction'
import en from '@/i18n/locales/en-US/time.json'
import fa from '@/i18n/locales/fa-IR/time.json'
import lo from '@/i18n/locales/lo-LA/time.json'
import zh from '@/i18n/locales/zh-Hans/time.json'

vi.unmock('react-i18next')

const localeRequests = vi.hoisted(() => {
  const deferred = () => {
    let resolve!: () => void
    const promise = new Promise<void>((done) => {
      resolve = done
    })
    return { promise, resolve }
  }
  return { german: deferred(), germanStarted: deferred(), italian: deferred() }
})

// boundary: Delay real locale modules to exercise a language change during code loading.
vi.mock('@daypicker/react/locale/de', async (importOriginal) => {
  localeRequests.germanStarted.resolve()
  await localeRequests.german.promise
  return importOriginal()
})
vi.mock('@daypicker/react/locale/it', async (importOriginal) => {
  await localeRequests.italian.promise
  return importOriginal()
})

beforeEach(async () => {
  document.documentElement.dir = 'ltr'
  document.documentElement.lang = 'en-US'
  await page.viewport(1000, 800)
})
afterEach(() => {
  document.documentElement.dir = 'ltr'
  document.documentElement.lang = 'en-US'
})

async function createI18n(language = 'en-US') {
  const i18n = createInstance()
  await i18n.init({
    lng: language,
    fallbackLng: 'en-US',
    defaultNS: 'time',
    keySeparator: false,
    resources: {
      'en-US': { time: en },
      'zh-Hans': { time: zh },
      'fa-IR': { time: fa },
      'lo-LA': { time: lo },
    },
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
  })
  return i18n
}

it('localizes empty picker placeholders and preserves a caller override', async () => {
  const i18n = await createI18n('zh-Hans')
  const screen = await render(
    <I18nextProvider i18n={i18n}>
      <DatePicker>
        <DatePickerLabel className="sr-only">Date</DatePickerLabel>
        <DatePickerTrigger />
      </DatePicker>
      <TimePicker>
        <TimePickerLabel className="sr-only">Time</TimePickerLabel>
        <TimePickerTrigger />
      </TimePicker>
      <DateTimePicker timeZone="UTC">
        <DateTimePickerLabel className="sr-only">Meeting</DateTimePickerLabel>
        <DateTimePickerTrigger />
      </DateTimePicker>
      <DatePicker placeholder="Choose billing day">
        <DatePickerLabel className="sr-only">Billing</DatePickerLabel>
        <DatePickerTrigger />
      </DatePicker>
    </I18nextProvider>,
  )
  await expect
    .element(screen.getByRole('button', { name: `Date ${zh['operation.pickDate']}` }))
    .toMatchTextContent(zh['operation.pickDate'])
  await expect
    .element(screen.getByRole('button', { name: `Meeting ${zh['operation.pickDate']}` }))
    .toMatchTextContent(zh['operation.pickDate'])
  await expect
    .element(screen.getByRole('button', { name: `Time ${zh['title.pickTime']}` }))
    .toMatchTextContent(zh['title.pickTime'])
  await expect
    .element(screen.getByRole('button', { name: 'Billing Choose billing day' }))
    .toMatchTextContent('Choose billing day')
})

it('updates time formatting and popup labels from the application language without locale props', async () => {
  const i18n = await createI18n()
  const screen = await render(
    <I18nextProvider i18n={i18n}>
      <I18nDirectionProvider syncDocument>
        <TimePicker defaultValue="13:30">
          <TimePickerLabel className="sr-only">Time</TimePickerLabel>
          <TimePickerTrigger />
          <TimePickerContent />
        </TimePicker>
      </I18nDirectionProvider>
    </I18nextProvider>,
  )
  await expect.element(screen.getByRole('button', { name: 'Time 1:30 PM' })).toBeInTheDocument()
  await i18n.changeLanguage('zh-Hans')
  await userEvent.click(screen.getByRole('button', { name: 'Time 下午1:30' }))
  await expect.element(screen.getByRole('listbox', { name: zh['picker.hour'] })).toBeInTheDocument()
  await expect.element(screen.getByRole('button', { name: zh['operation.ok'] })).toBeInTheDocument()
  await i18n.changeLanguage('fa-IR')
  await expect.element(screen.getByRole('button', { name: /Time ۱:۳۰/ })).toBeInTheDocument()
  await expect
    .element(screen.getByRole('listbox', { name: fa['picker.hour'] }))
    .toHaveAttribute('aria-orientation', 'vertical')
  await expect
    .element(screen.getByRole('option', { name: '۱' }))
    .toHaveAttribute('aria-selected', 'true')
  await expect
    .element(screen.getByRole('option', { name: '۳۰' }))
    .toHaveAttribute('aria-selected', 'true')
})

it('localizes the calendar from the application language while preserving label overrides', async () => {
  const i18n = await createI18n('fa-IR')
  const screen = await render(
    <I18nextProvider i18n={i18n}>
      <I18nDirectionProvider syncDocument>
        <DatePicker defaultValue="2025-01-15" labels={{ nextMonth: 'Next billing month' }}>
          <DatePickerLabel className="sr-only">Date</DatePickerLabel>
          <DatePickerTrigger />
          <DatePickerContent />
        </DatePicker>
      </I18nDirectionProvider>
    </I18nextProvider>,
  )
  await userEvent.click(screen.getByRole('button', { name: /^Date / }))
  await expect
    .element(screen.getByRole('button', { name: 'Next billing month' }))
    .toBeInTheDocument()
  await userEvent.click(
    screen.getByRole('button', { name: new RegExp(fa['picker.chooseMonthAndYear']) }),
  )
  await expect
    .element(screen.getByRole('option', { name: 'ژانویه' }))
    .toHaveAttribute('aria-selected', 'true')
})

it.each([
  ['zh-Hans', '今天，2026年9月28日 星期一，已选择'],
  [
    'lo-LA',
    new Intl.DateTimeFormat('lo-LA', { dateStyle: 'full', timeZone: 'UTC' }).format(
      new Date('2026-09-28T12:00:00Z'),
    ),
  ],
])('preserves localized calendar names and today semantics for %s', async (language, dayLabel) => {
  vi.setSystemTime(new Date('2026-09-28T12:00:00Z'))
  try {
    const i18n = await createI18n(language)
    const screen = await render(
      <I18nextProvider i18n={i18n}>
        <DatePicker
          defaultValue="2026-09-28"
          locale={{ labels: { labelNav: 'Calendar navigation' } }}
        >
          <DatePickerLabel className="sr-only">Date</DatePickerLabel>
          <DatePickerTrigger />
          <DatePickerContent />
        </DatePicker>
      </I18nextProvider>,
    )
    await userEvent.click(screen.getByRole('button', { name: /^Date / }))
    await expect
      .element(screen.getByRole('button', { name: `28: ${dayLabel}` }))
      .toHaveAttribute('aria-current', 'date')
    await expect.element(screen.getByRole('gridcell', { selected: true })).toBeInTheDocument()
    await expect
      .element(screen.getByRole('navigation', { name: 'Calendar navigation' }))
      .toBeInTheDocument()
  } finally {
    vi.useRealTimers()
  }
})

function TimeOwner() {
  const [value, setValue] = useState<string | null>('13:30')
  return (
    <>
      <TimePicker value={value} onValueChange={setValue}>
        <TimePickerLabel>Time</TimePickerLabel>
        <TimePickerTrigger />
        <TimePickerContent />
      </TimePicker>
      <output aria-label="Saved time">{value}</output>
    </>
  )
}

// Each language is a separate deferred asset; exercise its mapping through the calendar's
// selected day's accessible name, which must update from the temporary English fallback.
it.each([
  ['zh-Hant', '星期一'],
  ['ja-JP', '月曜日'],
  ['ko-KR', '월요일'],
  ['fr-FR', 'lundi'],
  ['es-ES', 'lunes'],
  ['pt-BR', 'segunda-feira'],
  ['ru-RU', 'понедельник'],
  ['uk-UA', 'понеділок'],
  ['pl-PL', 'poniedziałek'],
  ['nl-NL', 'maandag'],
  ['tr-TR', 'Pazartesi'],
  ['vi-VN', 'Thứ Hai'],
  ['id-ID', 'Senin'],
  ['th-TH', 'วันจันทร์'],
  ['hi-IN', 'सोमवार'],
  ['ar-TN', 'الاثنين'],
  ['ro-RO', 'luni'],
  ['sl-SI', 'ponedeljek'],
  ['az-AZ', 'Bazar ertəsi'],
])('loads accessible calendar weekday names for %s', async (language, monday) => {
  const i18n = await createI18n(language)
  const screen = await render(
    <I18nextProvider i18n={i18n}>
      <DatePicker defaultValue="2025-01-13">
        <DatePickerLabel>Date</DatePickerLabel>
        <DatePickerTrigger />
        <DatePickerContent />
      </DatePicker>
    </I18nextProvider>,
  )
  await screen.getByRole('button', { name: /^Date / }).click()
  await expect
    .element(
      screen.getByRole('gridcell', { selected: true }).getByRole('button', {
        name: new RegExp(monday),
      }),
    )
    .toBeVisible()
})

it('keeps an English calendar usable when the application language has no calendar locale', async () => {
  const i18n = await createI18n('en-GB')
  const screen = await render(
    <I18nextProvider i18n={i18n}>
      <DatePicker defaultValue="2025-01-13">
        <DatePickerLabel>Date</DatePickerLabel>
        <DatePickerTrigger />
        <DatePickerContent />
      </DatePicker>
    </I18nextProvider>,
  )
  await screen.getByRole('button', { name: /^Date / }).click()
  await expect
    .element(
      screen.getByRole('gridcell', { selected: true }).getByRole('button', { name: /Monday/ }),
    )
    .toBeVisible()
})

it('preserves the selected date and current language when an older locale finishes loading', async () => {
  const i18n = await createI18n('de-DE')
  const screen = await render(
    <I18nextProvider i18n={i18n}>
      <form aria-label="Appointment">
        <DatePicker name="date" defaultValue="2025-01-15">
          <DatePickerLabel>Date</DatePickerLabel>
          <DatePickerTrigger />
          <DatePickerContent />
        </DatePicker>
      </form>
    </I18nextProvider>,
  )
  await localeRequests.germanStarted.promise
  await screen.getByRole('button', { name: /^Date / }).click()
  await expect.element(screen.getByRole('dialog')).toBeVisible()
  await i18n.changeLanguage('it-IT')
  localeRequests.italian.resolve()
  await screen.getByRole('button', { name: /Choose month and year/ }).click()
  await expect
    .element(screen.getByRole('option', { name: 'gennaio' }))
    .toHaveAttribute('aria-selected', 'true')

  localeRequests.german.resolve()
  await import('@daypicker/react/locale/de')
  await expect
    .element(screen.getByRole('option', { name: 'gennaio' }))
    .toHaveAttribute('aria-selected', 'true')
  const form = screen.getByRole('form', { name: 'Appointment' }).element()
  if (!(form instanceof HTMLFormElement)) throw new TypeError('Expected the appointment form')
  expect(new FormData(form).get('date')).toBe('2025-01-15')
  await userEvent.keyboard('{Escape}')
  await expect.element(screen.getByRole('option', { name: 'gennaio' })).not.toBeInTheDocument()
  await userEvent.keyboard('{Escape}')
  await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument()
  await expect.element(screen.getByRole('button', { name: /^Date / })).toHaveFocus()
})

it('localizes dismissal and retains the saved time through a real close and reopen', async () => {
  const i18n = await createI18n('zh-Hans')
  const screen = await render(
    <I18nextProvider i18n={i18n}>
      <TimeOwner />
    </I18nextProvider>,
  )
  const trigger = screen.getByRole('button', { name: /^Time / })
  await trigger.click()
  const close = screen.getByRole('button', { name: zh['operation.close'] })
  // This visually hidden action names assistive-technology dismissal; Escape is the native keyboard path.
  await expect.element(close).toHaveAccessibleName(zh['operation.close'])
  await userEvent.keyboard('{Escape}')
  await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument()
  await expect.element(trigger).toHaveFocus()
  await expect
    .element(screen.getByRole('status', { name: 'Saved time' }))
    .toHaveTextContent('13:30')
  await userEvent.keyboard('{Enter}')
  await expect.element(screen.getByRole('listbox', { name: zh['picker.hour'] })).toBeVisible()
  await expect.element(trigger).toMatchTextContent('下午1:30')
  await userEvent.keyboard('{Escape}')
  await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument()
  await expect.element(trigger).toHaveFocus()
  await expect
    .element(screen.getByRole('status', { name: 'Saved time' }))
    .toHaveTextContent('13:30')
})
