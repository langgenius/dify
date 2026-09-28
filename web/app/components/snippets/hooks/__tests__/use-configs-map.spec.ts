import type { FileUploadConfigResponse } from '@/models/common'
import { renderWorkflowHook } from '@/app/components/workflow/__tests__/workflow-test-env'
import { Resolution, TransferMethod } from '@/types/app'
import { FlowType } from '@/types/common'
import { useConfigsMap } from '../use-configs-map'

describe('useConfigsMap', () => {
  it('should build snippet workflow configs from the snippet id and workflow file upload config', () => {
    const fileUploadConfig = {
      batch_count_limit: 5,
      image_file_batch_limit: 3,
      file_size_limit: 15,
      workflow_file_upload_limit: 10,
    } as FileUploadConfigResponse

    const { result, rerender } = renderWorkflowHook(
      ({ snippetId }: { snippetId: string }) => useConfigsMap(snippetId),
      {
        initialProps: { snippetId: 'snippet-1' },
        initialStoreState: {
          fileUploadConfig,
        },
      },
    )

    expect(result.current).toEqual({
      flowId: 'snippet-1',
      flowType: FlowType.snippet,
      fileSettings: {
        image: {
          enabled: false,
          detail: Resolution.high,
          number_limits: 3,
          transfer_methods: [TransferMethod.local_file, TransferMethod.remote_url],
        },
        fileUploadConfig,
      },
    })

    const firstConfigs = result.current

    rerender({ snippetId: 'snippet-1' })

    expect(result.current).toBe(firstConfigs)

    rerender({ snippetId: 'snippet-2' })

    expect(result.current.flowId).toBe('snippet-2')
    expect(result.current).not.toBe(firstConfigs)
  })
})
