import { useRequest } from 'ahooks'

export const useCheckInstallStatus = () => {
  const { data, run, cancel } = useRequest(async () => {}, {
    manual: true,
    pollingInterval: 5000,
    pollingErrorRetryCount: 2,
  })

  return {
    data,
    run,
    cancel,
  }
}
