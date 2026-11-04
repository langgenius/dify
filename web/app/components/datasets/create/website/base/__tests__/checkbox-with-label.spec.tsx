import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CheckboxWithLabel from '../checkbox-with-label'

it('changes the labeled crawl option without activating its help control', async () => {
  const user = userEvent.setup()
  const onChange = vi.fn()
  render(
    <CheckboxWithLabel
      isChecked={false}
      onChange={onChange}
      label="Include subpages"
      tooltip="Crawl linked subpages"
    />,
  )
  await user.click(screen.getByRole('button', { name: 'Include subpages' }))
  expect(await screen.findByText('Crawl linked subpages')).toBeInTheDocument()
  expect(onChange).not.toHaveBeenCalled()
  await user.keyboard('{Escape}')
  await user.click(screen.getByRole('checkbox', { name: 'Include subpages' }))
  expect(onChange).toHaveBeenCalledExactlyOnceWith(true)
})
