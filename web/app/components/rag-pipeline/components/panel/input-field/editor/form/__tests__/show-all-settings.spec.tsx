import type { ComponentType } from 'react'
import { useStore } from '@tanstack/react-form'
import { fireEvent, render, screen } from '@testing-library/react'
import { PipelineInputVarType } from '@/models/pipeline'
import { useHiddenFieldNames } from '../hooks'
import ShowAllSettings from '../show-all-settings'

type MockForm = {
  store: object
}

const mockForm = vi.hoisted(() => ({
  store: {},
})) as MockForm

vi.mock('@tanstack/react-form', () => ({
  useStore: vi.fn(),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { ns?: string }) => options?.ns ? `${options.ns}.${key}` : key,
  }),
}))

vi.mock('@/app/components/base/form', () => ({
  withForm: ({ render }: {
    render: (props: { form: MockForm }) => React.ReactNode
  }) => ({ form }: { form?: MockForm }) => render({ form: form ?? mockForm }),
}))

vi.mock('../hooks', () => ({
  useHiddenFieldNames: vi.fn(),
}))

describe('ShowAllSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useStore).mockImplementation((_, selector) => selector({
      values: {
        type: PipelineInputVarType.textInput,
      },
    }))
    vi.mocked(useHiddenFieldNames).mockReturnValue('default value, placeholder')
  })

  it('should render the summary and hidden field names', () => {
    const ShowAllSettingsComp = ShowAllSettings({
      handleShowAllSettings: vi.fn(),
    }) as unknown as ComponentType
    render(<ShowAllSettingsComp />)

    expect(useHiddenFieldNames).toHaveBeenCalledWith(PipelineInputVarType.textInput)
    expect(screen.getByText('appDebug.variableConfig.showAllSettings')).toBeInTheDocument()
    expect(screen.getByText('default value, placeholder')).toBeInTheDocument()
  })

  it('should call the click handler when the row is pressed', () => {
    const handleShowAllSettings = vi.fn()
    const ShowAllSettingsComp = ShowAllSettings({
      handleShowAllSettings,
    }) as unknown as ComponentType
    render(<ShowAllSettingsComp />)

    fireEvent.click(screen.getByText('appDebug.variableConfig.showAllSettings'))

    expect(handleShowAllSettings).toHaveBeenCalledTimes(1)
  })
})
