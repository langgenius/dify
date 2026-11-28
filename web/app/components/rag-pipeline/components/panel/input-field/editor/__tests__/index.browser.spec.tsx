import type { InputFieldEditorProps } from '../index'
import { QueryClientProvider } from '@tanstack/react-query'
import { ReactFlowProvider } from 'reactflow'
import { page } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { WorkflowContextProvider } from '@/app/components/workflow/context'
import { PipelineInputVarType } from '@/models/pipeline'
import { setupFakeApi } from '@/test/fake-api'
import { createFileUploadConfigFixture } from '@/test/fixtures/file-upload-config'
import { createPipelineVariable } from '@/test/pipeline-variables'
import { createTestQueryClient } from '@/test/query-client'
import InputFieldEditorPanel from '../index'

setupFakeApi({
  console: {
    files: { upload: { get: () => createFileUploadConfigFixture() } },
  },
})

it('saves a checkbox as text input without carrying its unchecked default', async () => {
  const onSubmit = vi.fn<InputFieldEditorProps['onSubmit']>()
  const checkbox = createPipelineVariable({
    type: PipelineInputVarType.checkbox,
    default_value: false,
  })

  await render(
    <QueryClientProvider client={createTestQueryClient()}>
      <WorkflowContextProvider>
        <ReactFlowProvider>
          <InputFieldEditorPanel initialData={checkbox} onSubmit={onSubmit} onClose={vi.fn()} />
        </ReactFlowProvider>
      </WorkflowContextProvider>
    </QueryClientProvider>,
  )

  await page.getByRole('combobox', { name: /variableConfig.fieldType/ }).click()
  await page.getByRole('option', { name: /variableConfig.text-input/ }).click()
  await page.getByRole('textbox', { name: /variableConfig.maxLength/ }).fill('40')
  await page.getByRole('button', { name: /operation.submit/ }).click()

  await expect.poll(() => onSubmit).toHaveBeenCalledOnce()
  const [savedField] = onSubmit.mock.calls[0]!
  expect(savedField).toMatchObject({ type: PipelineInputVarType.textInput, max_length: 40 })
  expect(savedField.default_value).toBeUndefined()
})
