import { render } from 'vitest-browser-react'
import { AgentMonitoringTimeRangePicker } from '../time-range-picker'

async function setup() {
  const onChange = vi.fn()
  const screen = await render(
    <AgentMonitoringTimeRangePicker
      value={{ name: 'Nov 6 - Nov 6', query: { start: '2026-11-06 00:00', end: '2026-11-06 23:59' } }}
      onChange={onChange}
    />,
  )
  return { screen, onChange }
}

it('sends the picked end date at the end of the day so the whole date is counted', async () => {
  const { screen, onChange } = await setup()

  await screen.getByRole('button', { name: /picker.endDate/ }).click()
  await screen.getByRole('button', { name: /November 7th, 2026/ }).click()

  expect(onChange).toHaveBeenCalledTimes(1)
  expect(onChange.mock.calls[0]![0].query).toEqual({
    start: '2026-11-06 00:00',
    end: '2026-11-07 23:59',
  })
})

it('keeps the picked start date at the start of the day', async () => {
  const { screen, onChange } = await setup()

  await screen.getByRole('button', { name: /picker.startDate/ }).click()
  await screen.getByRole('button', { name: /November 5th, 2026/ }).click()

  expect(onChange).toHaveBeenCalledTimes(1)
  expect(onChange.mock.calls[0]![0].query).toEqual({
    start: '2026-11-05 00:00',
    end: '2026-11-06 23:59',
  })
})
