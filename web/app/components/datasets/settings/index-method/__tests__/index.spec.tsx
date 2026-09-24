import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { IndexingType } from '../../../create/step-two'
import IndexMethod from '../index'

const Settings = ({
  disabled = false,
  currentValue = IndexingType.ECONOMICAL,
}: {
  disabled?: boolean
  currentValue?: IndexingType
}) => {
  const [value, setValue] = useState<IndexingType>(currentValue)
  const [keywordNumber, setKeywordNumber] = useState(10)
  return (
    <IndexMethod
      value={value}
      onChange={setValue}
      currentValue={currentValue}
      disabled={disabled}
      keywordNumber={keywordNumber}
      onKeywordNumberChange={setKeywordNumber}
    />
  )
}

describe('IndexMethod', () => {
  it('hides inactive economy parameters and preserves their draft when switching back', async () => {
    const user = userEvent.setup()
    render(<Settings />)
    const group = screen.getByRole('radiogroup', { name: 'datasetSettings.form.indexMethod' })
    const economy = within(group).getByRole('radio', {
      name: 'datasetSettings.form.indexMethodEconomy',
    })
    const qualified = within(group).getByRole('radio', {
      name: 'datasetCreation.stepTwo.qualified',
    })
    const input = screen.getByRole('textbox', { name: 'datasetSettings.form.numberOfKeywords' })
    expect(economy).toBeChecked()
    expect(economy).not.toContainElement(input)
    await user.clear(input)
    await user.type(input, '25')
    await user.tab()
    await user.click(qualified)
    expect(qualified).toBeChecked()
    expect(economy).not.toBeChecked()
    expect(
      screen.queryByRole('textbox', { name: 'datasetSettings.form.numberOfKeywords' }),
    ).not.toBeInTheDocument()
    await user.click(economy)
    expect(
      screen.getByRole('textbox', { name: 'datasetSettings.form.numberOfKeywords' }),
    ).toHaveValue('25')
  })

  it.each(['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown'])(
    'keeps Economy selected while editing keywords with %s',
    async (key) => {
      const user = userEvent.setup()
      render(<Settings />)
      const input = screen.getByRole('textbox', { name: 'datasetSettings.form.numberOfKeywords' })
      await user.click(input)
      await user.keyboard(key === 'ArrowLeft' ? '{Home}' : '{End}')
      await user.keyboard(`{${key}}`)

      expect(
        screen.getByRole('radio', { name: 'datasetSettings.form.indexMethodEconomy' }),
      ).toBeChecked()
      expect(
        screen.getByRole('radio', { name: 'datasetCreation.stepTwo.qualified' }),
      ).not.toBeChecked()
      expect(input).toBeInTheDocument()
      expect(input).toHaveFocus()
    },
  )

  it('uses arrow keys to select one index method without toggling the selected radio off', async () => {
    const user = userEvent.setup()
    render(<Settings />)
    const economy = screen.getByRole('radio', { name: 'datasetSettings.form.indexMethodEconomy' })
    const qualified = screen.getByRole('radio', { name: 'datasetCreation.stepTwo.qualified' })
    economy.focus()
    await user.keyboard('{ArrowUp}')
    expect(qualified).toHaveFocus()
    expect(qualified).toBeChecked()
    expect(economy).not.toBeChecked()
    await user.keyboard(' ')
    expect(qualified).toBeChecked()
  })

  it('prevents editing keywords or selection while settings are disabled', async () => {
    const user = userEvent.setup()
    render(<Settings disabled />)
    const input = screen.getByRole('textbox', { name: 'datasetSettings.form.numberOfKeywords' })
    expect(input).toBeDisabled()
    const qualified = screen.getByRole('radio', { name: 'datasetCreation.stepTwo.qualified' })
    await user.click(qualified)
    expect(qualified).not.toBeChecked()
  })

  it('does not allow an existing high quality dataset to downgrade to economy', async () => {
    const user = userEvent.setup()
    render(<Settings currentValue={IndexingType.QUALIFIED} />)
    const economy = screen.getByRole('radio', { name: 'datasetSettings.form.indexMethodEconomy' })
    await user.click(economy)
    expect(economy).not.toBeChecked()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('shows and associates the downgrade explanation without opening a popup', () => {
    render(<Settings currentValue={IndexingType.QUALIFIED} />)
    const economy = screen.getByRole('radio', { name: 'datasetSettings.form.indexMethodEconomy' })

    expect(
      screen.getByText(/datasetSettings.form.indexMethodChangeToEconomyDisabledTip/),
    ).toBeVisible()
    expect(economy).toHaveAccessibleDescription(
      /datasetSettings.form.indexMethodChangeToEconomyDisabledTip/,
    )
  })
})
