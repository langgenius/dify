import { TooltipProvider } from '@langgenius/dify-ui/tooltip'
import { render } from 'vitest-browser-react'
import ReuseFromNode from '..'

it('explains unavailable source selection and clears the warning when a configured node appears', async () => {
  const screen = await render(
    <TooltipProvider>
      <ReuseFromNode nodes={[]} />
    </TooltipProvider>,
  )
  const select = screen.getByRole('combobox', { name: 'plugin.auth.reuse.selectNode' })
  await expect.element(select).toBeDisabled()
  await expect
    .element(screen.getByRole('alert'))
    .toHaveTextContent('plugin.auth.reuse.noConfiguredNodes')
  await expect.element(select).toHaveAccessibleDescription('plugin.auth.reuse.noConfiguredNodes')

  await screen.rerender(
    <TooltipProvider>
      <ReuseFromNode
        nodes={[{ id: 'configured-tool', title: 'Configured tool', source: 'workspace' }]}
      />
    </TooltipProvider>,
  )
  await expect.element(select).toBeEnabled()
  await expect.element(screen.getByRole('alert')).not.toBeInTheDocument()
  await expect.element(select).toHaveAccessibleDescription('')
})
