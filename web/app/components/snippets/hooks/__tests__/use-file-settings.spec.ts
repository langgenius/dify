import { act } from '@testing-library/react'
import { renderWorkflowHook } from '@/app/components/workflow/__tests__/workflow-test-env'
import { createFileUploadConfigFixture } from '@/test/fixtures/file-upload-config'
import { Resolution, TransferMethod } from '@/types/app'
import { useFileSettings } from '../use-file-settings'

describe('useFileSettings', () => {
  it('updates upload limits from the editor while keeping snippet image inputs disabled', () => {
    const fileUploadConfig = createFileUploadConfigFixture({ workflow_file_upload_limit: 10 })
    const { result, store } = renderWorkflowHook(useFileSettings, {
      resource: { kind: 'snippet', snippetId: 'snippet-1' },
      initialStoreState: { fileUploadConfig },
    })
    expect(result.current).toEqual({
      image: {
        enabled: false,
        detail: Resolution.high,
        number_limits: 3,
        transfer_methods: [TransferMethod.local_file, TransferMethod.remote_url],
      },
      fileUploadConfig,
    })
    act(() =>
      store.setState({ fileUploadConfig: { ...fileUploadConfig, workflow_file_upload_limit: 20 } }),
    )
    expect(result.current.fileUploadConfig?.workflow_file_upload_limit).toBe(20)
  })
})
