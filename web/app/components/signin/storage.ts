import { createLocalStorageState } from 'foxact/create-local-storage-state'

export const COUNT_DOWN_TIME_MS = 59000
export const COUNT_DOWN_KEY = 'leftTime'

const [_useCountdownLeftTime, useCountdownLeftTimeValue, useSetCountdownLeftTime] =
  createLocalStorageState<string>(COUNT_DOWN_KEY, undefined, { raw: true })

export { useCountdownLeftTimeValue, useSetCountdownLeftTime }
