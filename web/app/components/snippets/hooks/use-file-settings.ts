import { useMemo } from 'react'
import { useStore } from '@/app/components/workflow/store'
import { Resolution, TransferMethod } from '@/types/app'

export const useFileSettings = () => {
  const fileUploadConfig = useStore((s) => s.fileUploadConfig)

  return useMemo(() => {
    return {
      image: {
        enabled: false,
        detail: Resolution.high,
        number_limits: 3,
        transfer_methods: [TransferMethod.local_file, TransferMethod.remote_url],
      },
      fileUploadConfig,
    }
  }, [fileUploadConfig])
}
