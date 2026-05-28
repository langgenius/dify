import type { InputFieldFormProps } from '../types'
import { fireEvent, render, screen } from '@testing-library/react'
import { useAppForm } from '@/app/components/base/form'
import { PipelineInputVarType } from '@/models/pipeline'
import { useHiddenFieldNames } from '../hooks'
import ShowAllSettings from '../show-all-settings'

vi.mock('../hooks', () => ({
  useHiddenFieldNames: vi.fn(),
}))

describe('ShowAllSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useHiddenFieldNames).mockReturnValue('default value, placeholder')
  })

  it('should render the summary and hidden field names', () => {
    const ShowAllSettingsHarness = () => {
      const initialData: InputFieldFormProps['initialData'] = {
        type: PipelineInputVarType.textInput,
      }
      const form = useAppForm({
        defaultValues: initialData,
        onSubmit: () => {},
      })
      const ShowAllSettingsComp = ShowAllSettings({
        initialData,
        handleShowAllSettings: vi.fn(),
      })
      return <ShowAllSettingsComp form={form} />
    }
    render(<ShowAllSettingsHarness />)

    expect(useHiddenFieldNames).toHaveBeenCalledWith(PipelineInputVarType.textInput)
    expect(screen.getByText('appDebug.variableConfig.showAllSettings')).toBeInTheDocument()
    expect(screen.getByText('default value, placeholder')).toBeInTheDocument()
  })

  it('should call the click handler when the row is pressed', () => {
    const handleShowAllSettings = vi.fn()
    const ShowAllSettingsHarness = () => {
      const initialData: InputFieldFormProps['initialData'] = {
        type: PipelineInputVarType.textInput,
      }
      const form = useAppForm({
        defaultValues: initialData,
        onSubmit: () => {},
      })
      const ShowAllSettingsComp = ShowAllSettings({
        initialData,
        handleShowAllSettings,
      })
      return <ShowAllSettingsComp form={form} />
    }
    render(<ShowAllSettingsHarness />)

    fireEvent.click(screen.getByRole('button', { name: /appDebug\.variableConfig\.showAllSettings/ }))

    expect(handleShowAllSettings).toHaveBeenCalledTimes(1)
  })
})
