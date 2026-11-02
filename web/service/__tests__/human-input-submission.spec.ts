import {
  HumanInputSubmissionPreparationError,
  prepareHumanInputFormSubmission,
} from '../human-input-submission'

afterEach(() => vi.useRealTimers())

it('reports a disposed or failed reconnect instead of treating it as a successful submission', async () => {
  await expect(
    prepareHumanInputFormSubmission(() => Promise.resolve(false)),
  ).rejects.toBeInstanceOf(HumanInputSubmissionPreparationError)
})

it('times out when workflow readiness never arrives', async () => {
  vi.useFakeTimers()
  const pending = prepareHumanInputFormSubmission(() => new Promise<boolean>(() => {}))
  const assertion = expect(pending).rejects.toBeInstanceOf(HumanInputSubmissionPreparationError)
  await vi.advanceTimersByTimeAsync(15_000)
  await assertion
})

it('clears its timeout after readiness succeeds', async () => {
  vi.useFakeTimers()
  await prepareHumanInputFormSubmission(() => Promise.resolve(true))
  expect(vi.getTimerCount()).toBe(0)
})
