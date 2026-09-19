import { render } from 'vitest-browser-react'
import SingleRunForm from '../single-run-form'

vi.mock('react-i18next', async () => {
  const { createReactI18nextMock } = await import('@/test/i18n-mock')
  return createReactI18nextMock({ 'workflow.nodes.humanInput.singleRun.back': 'Back' })
})

it('keeps the full node name inside the form panel', async () => {
  const name = 'Research and development platform engineering operations team'
  const screen = await render(
    <div style={{ width: 400 }}>
      <SingleRunForm
        nodeName={name}
        showBackButton
        handleBack={() => {}}
        data={{
          form_id: 'form',
          node_id: 'node',
          node_title: name,
          form_content: '',
          inputs: [],
          actions: [],
          form_token: 'token',
          resolved_default_values: {},
          display_in_ui: true,
          expiration_time: 0,
        }}
      />
    </div>,
  )
  const navigation = screen.getByRole('navigation', { name }).element()
  const bounds = navigation.getBoundingClientRect()
  const text = document.createRange()
  text.selectNodeContents(screen.getByText(name, { exact: true }).element())
  for (const line of text.getClientRects()) {
    expect(line.right).toBeLessThanOrEqual(bounds.right)
    expect(line.bottom).toBeLessThanOrEqual(bounds.bottom)
  }
  expect(navigation.scrollWidth).toBeLessThanOrEqual(navigation.clientWidth)
})
