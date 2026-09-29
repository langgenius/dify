import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
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
import en from '@/i18n/locales/en-US/time.json'
import fa from '@/i18n/locales/fa-IR/time.json'
import lo from '@/i18n/locales/lo-LA/time.json'
import zh from '@/i18n/locales/zh-Hans/time.json'

vi.unmock('react-i18next')

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
  render(
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
  expect(screen.getByRole('button', { name: 'Date' })).toHaveTextContent(zh['operation.pickDate'])
  expect(screen.getByRole('button', { name: 'Meeting' })).toHaveTextContent(
    zh['operation.pickDate'],
  )
  expect(screen.getByRole('button', { name: 'Time' })).toHaveTextContent(zh['title.pickTime'])
  expect(screen.getByRole('button', { name: 'Billing' })).toHaveTextContent('Choose billing day')
})

it('updates time formatting and popup labels from the application language without locale props', async () => {
  const user = userEvent.setup()
  const i18n = await createI18n()
  render(
    <I18nextProvider i18n={i18n}>
      <TimePicker defaultValue="13:30">
        <TimePickerLabel className="sr-only">Time</TimePickerLabel>
        <TimePickerTrigger />
        <TimePickerContent />
      </TimePicker>
    </I18nextProvider>,
  )
  expect(screen.getByRole('button', { name: 'Time 1:30 PM' })).toBeInTheDocument()
  await act(() => i18n.changeLanguage('zh-Hans'))
  await user.click(screen.getByRole('button', { name: 'Time 下午1:30' }))
  expect(screen.getByRole('listbox', { name: zh['picker.hour'] })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: zh['operation.ok'] })).toBeInTheDocument()
  await act(() => i18n.changeLanguage('fa-IR'))
  expect(screen.getByRole('button', { name: /Time ۱:۳۰/ })).toBeInTheDocument()
  expect(screen.getByRole('listbox', { name: fa['picker.hour'] })).toHaveAttribute(
    'aria-orientation',
    'vertical',
  )
  expect(screen.getByRole('option', { name: '۱' })).toHaveAttribute('aria-selected', 'true')
  expect(screen.getByRole('option', { name: '۳۰' })).toHaveAttribute('aria-selected', 'true')
  expect(screen.getByRole('dialog')).toHaveAttribute('dir', 'rtl')
})

it('owns the application calendar locale and RTL while preserving caller label overrides', async () => {
  const user = userEvent.setup()
  const i18n = await createI18n('fa-IR')
  render(
    <I18nextProvider i18n={i18n}>
      <DatePicker defaultValue="2025-01-15" labels={{ nextMonth: 'Next billing month' }}>
        <DatePickerLabel className="sr-only">Date</DatePickerLabel>
        <DatePickerTrigger />
        <DatePickerContent />
      </DatePicker>
    </I18nextProvider>,
  )
  const trigger = screen.getByRole('button', { name: /^Date / })
  expect(trigger).toHaveAttribute('dir', 'rtl')
  await user.click(trigger)
  expect(screen.getByRole('dialog', { name: 'Date' })).toHaveAttribute('dir', 'rtl')
  expect(screen.getByRole('button', { name: 'Next billing month' })).toBeInTheDocument()
  await user.click(
    screen.getByRole('button', { name: new RegExp(fa['picker.chooseMonthAndYear']) }),
  )
  expect(screen.getByRole('option', { name: 'ژانویه' })).toHaveAttribute('aria-selected', 'true')
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
    const user = userEvent.setup()
    const i18n = await createI18n(language)
    render(
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
    await user.click(screen.getByRole('button', { name: /^Date / }))
    expect(screen.getByRole('button', { name: dayLabel })).toHaveAttribute('aria-current', 'date')
    expect(screen.getByRole('gridcell', { selected: true })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Calendar navigation' })).toBeInTheDocument()
  } finally {
    vi.useRealTimers()
  }
})
