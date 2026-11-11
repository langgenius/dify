import type { InjectWorkflowStoreSliceFn } from '@/app/components/workflow/store/workflow'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWorkflowFlowComponent } from '@/app/components/workflow/__tests__/workflow-test-env'
import { createRagPipelineSliceSlice } from '../../../../store'
import Header from '../header'

const renderHeader = (isPreparingDataSource: boolean) =>
  renderWorkflowFlowComponent(<Header />, {
    resource: { kind: 'knowledge-pipeline', pipelineId: 'pipeline-1' },
    injectWorkflowStoreSliceFn: createRagPipelineSliceSlice as InjectWorkflowStoreSliceFn,
    initialStoreState: { isPreparingDataSource, showDebugAndPreviewPanel: true },
  })

describe('TestRun header', () => {
  it.each([true, false])(
    'closes the test run panel and leaves datasource preparation (preparing=%s)',
    async (isPreparingDataSource) => {
      const user = userEvent.setup()
      const { store } = renderHeader(isPreparingDataSource)

      expect(screen.getByText('datasetPipeline.testRun.title')).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'common.operation.close' }))

      expect(store.getState()).toMatchObject({
        isPreparingDataSource: false,
        showDebugAndPreviewPanel: false,
        workflowRunningData: undefined,
      })
    },
  )
})
