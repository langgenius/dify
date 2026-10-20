import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Header from '../header'

it('links to datasource documentation and opens that plugin configuration', async () => {
  const user = userEvent.setup()
  const onClickConfiguration = vi.fn()
  render(
    <Header
      docTitle="Datasource documentation"
      docLink="https://docs.example.com/source"
      pluginName="Drive"
      onClickConfiguration={onClickConfiguration}
      credentials={[]}
      currentCredentialId=""
      onCredentialChange={vi.fn()}
    />,
  )
  expect(screen.getByRole('link', { name: 'Datasource documentation' })).toHaveAttribute(
    'href',
    'https://docs.example.com/source',
  )
  await user.click(screen.getByRole('button', { name: /datasetPipeline.configurationTip/ }))
  expect(onClickConfiguration).toHaveBeenCalledOnce()
})
