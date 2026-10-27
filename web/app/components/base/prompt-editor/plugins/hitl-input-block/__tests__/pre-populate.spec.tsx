import type { i18n as I18nType } from 'i18next'
import type { ReactNode } from 'react'
import type { Var } from '@/app/components/workflow/types'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18next from 'i18next'
import { useState } from 'react'
import { I18nextProvider, initReactI18next } from 'react-i18next'
import { VarType } from '@/app/components/workflow/types'
import PrePopulate from '../pre-populate'

vi.unmock('react-i18next')

type VarReferencePickerProps = {
  onChange: (value: string[]) => void
  filterVar: (v: Var) => boolean
}

vi.mock('@/app/components/workflow/nodes/_base/components/variable/var-reference-picker', () => ({
  default: (props: VarReferencePickerProps) => {
    return (
      <>
        {(['string', 'number', 'secret', 'object'] as const)
          .filter((type) => props.filterVar({ variable: type, type: VarType[type] }))
          .map((type) => (
            <button key={type} type="button" onClick={() => props.onChange(['node-1', type])}>
              {type} variable
            </button>
          ))}
      </>
    )
  },
}))

let i18n: I18nType

const renderWithI18n = (ui: ReactNode) => {
  return render(<I18nextProvider i18n={i18n}>{ui}</I18nextProvider>)
}

describe('PrePopulate', () => {
  beforeAll(async () => {
    i18n = i18next.createInstance()
    await i18n.use(initReactI18next).init({
      lng: 'en-US',
      fallbackLng: 'en-US',
      defaultNS: 'workflowHumanInput',
      interpolation: { escapeValue: false },
      resources: {
        'en-US': {
          workflowHumanInput: {
            nodes: {
              humanInput: {
                insertInputField: {
                  prePopulateFieldPlaceholder: '<staticContent/> <variable/>',
                  staticContent: 'Static Content',
                  variable: 'Variable',
                  useVarInstead: 'Use Variable Instead',
                  useConstantInstead: 'Use Constant Instead',
                },
              },
            },
          },
        },
      },
    })
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('keeps Tab navigation native and opens static content on activation', async () => {
    const user = userEvent.setup()
    renderWithI18n(<PrePopulate nodeId="node-1" isVariable={false} value="" />)

    expect(screen.getByText('Static Content')).toBeInTheDocument()

    await user.keyboard('{Tab}')

    expect(screen.getByRole('button', { name: 'Static Content' })).toHaveFocus()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    await user.keyboard('{Enter}')
    expect(screen.getByRole('textbox')).toHaveFocus()
  })

  it('should update constant value and toggle to variable mode when type switch is clicked', async () => {
    const user = userEvent.setup()
    const onValueChange = vi.fn()
    const onIsVariableChange = vi.fn()

    const Wrapper = () => {
      const [value, setValue] = useState('initial value')
      return (
        <PrePopulate
          nodeId="node-1"
          isVariable={false}
          value={value}
          onValueChange={(next) => {
            onValueChange(next)
            setValue(next)
          }}
          onIsVariableChange={onIsVariableChange}
        />
      )
    }

    renderWithI18n(<Wrapper />)

    await user.clear(screen.getByRole('textbox'))
    await user.type(screen.getByRole('textbox'), 'next')
    await user.click(screen.getByText('Use Variable Instead'))

    expect(onValueChange).toHaveBeenLastCalledWith('next')
    expect(onIsVariableChange).toHaveBeenCalledWith(true)
  })

  it('should render variable picker mode and propagate selected value selector', async () => {
    const user = userEvent.setup()
    const onValueSelectorChange = vi.fn()
    const onIsVariableChange = vi.fn()

    renderWithI18n(
      <PrePopulate
        nodeId="node-2"
        isVariable
        valueSelector={['node-2', 'existing']}
        onValueSelectorChange={onValueSelectorChange}
        onIsVariableChange={onIsVariableChange}
      />,
    )

    expect(screen.queryByRole('button', { name: 'object variable' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'string variable' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'secret variable' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'number variable' }))
    await user.click(screen.getByText('Use Constant Instead'))

    expect(onValueSelectorChange).toHaveBeenCalledWith(['node-1', 'number'])
    expect(onIsVariableChange).toHaveBeenCalledWith(false)
  })
})
