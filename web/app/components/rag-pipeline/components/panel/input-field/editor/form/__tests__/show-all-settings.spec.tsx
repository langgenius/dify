import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useAppForm } from '@/app/components/base/form'
import { PipelineInputVarType } from '@/models/pipeline'
import ShowAllSettings from '../show-all-settings'

it('updates the settings summary when the form type changes and opens the settings', async () => {
  const user = userEvent.setup()
  const openSettings = vi.fn()
  const initialData: NonNullable<Parameters<typeof ShowAllSettings>[0]['initialData']> = {
    type: PipelineInputVarType.textInput,
  }
  const Settings = ShowAllSettings({ initialData, handleShowAllSettings: openSettings })
  const Harness = () => {
    const form = useAppForm({ defaultValues: initialData })
    return (
      <>
        <button onClick={() => form.setFieldValue('type', PipelineInputVarType.multiFiles)}>
          Use file list
        </button>
        <Settings form={form} />
      </>
    )
  }
  render(<Harness />)
  const settings = screen.getByRole('button', { name: /variableConfig.showAllSettings/ })
  expect(settings).toHaveTextContent(
    'appdebug.variableconfig.defaultvalue, appdebug.variableconfig.placeholder, appdebug.variableconfig.tooltips',
  )
  await user.click(screen.getByRole('button', { name: 'Use file list' }))
  expect(settings).toHaveTextContent(
    'appdebug.variableconfig.uploadmethod, appdebug.variableconfig.maxnumberofuploads, appdebug.variableconfig.tooltips',
  )
  await user.click(settings)
  expect(openSettings).toHaveBeenCalledOnce()
})
