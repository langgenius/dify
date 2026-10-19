import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import OptionsWrap from '../options-wrap'

it('lets users reopen crawler options after the owner folds them', async () => {
  const user = userEvent.setup()
  const { rerender } = render(
    <OptionsWrap>
      <input aria-label="Page limit" />
    </OptionsWrap>,
  )
  expect(screen.getByRole('textbox', { name: 'Page limit' })).toBeInTheDocument()
  rerender(
    <OptionsWrap controlFoldOptions={1}>
      <input aria-label="Page limit" />
    </OptionsWrap>,
  )
  expect(screen.queryByRole('textbox', { name: 'Page limit' })).not.toBeInTheDocument()
  await user.click(screen.getByText('datasetCreation.stepOne.website.options'))
  expect(screen.getByRole('textbox', { name: 'Page limit' })).toBeInTheDocument()
  await user.click(screen.getByText('datasetCreation.stepOne.website.options'))
  expect(screen.queryByRole('textbox', { name: 'Page limit' })).not.toBeInTheDocument()
})
