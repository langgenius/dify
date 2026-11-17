import { page, userEvent } from 'vite-plus/test/browser'
import { createChatThoughtFixture } from '@/test/fixtures/chat'
import { guardUnexpectedFetch } from '@/test/unexpected-fetch'
import { renderChat } from '../../__tests__/chat-browser-test-env'
import Thought from '../index'

vi.unmock('react-i18next')

beforeEach(async () => {
  await page.viewport(800, 600)
  onTestFinished(guardUnexpectedFetch())
})

it('keeps each tool’s request and response paired through keyboard disclosure and streaming completion', async () => {
  const thought = createChatThoughtFixture({
    tool: JSON.stringify(['dataset_123', 'weather', 'unlabelled']),
    tool_labels: { weather: { en_US: 'Weather forecast', zh_Hans: '天气预报' } },
    tool_input: JSON.stringify(['search input', 'weather input', 'pending input']),
    observation: JSON.stringify(['search output', 'weather output']),
  })
  const screen = await renderChat(
    <>
      <button>Before tools</button>
      <Thought thought={thought} isFinished={false} />
    </>,
  )
  await screen.getByRole('button', { name: 'Before tools' }).click()
  await userEvent.tab()
  const knowledge = screen.getByRole('button', { name: 'Using Knowledge' })
  await expect.element(knowledge).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await expect.element(screen.getByText('search input')).toBeVisible()
  await expect.element(screen.getByText('search output')).toBeVisible()
  await expect.element(screen.getByText('weather input')).not.toBeInTheDocument()
  await userEvent.keyboard('{Space}')
  await expect.element(screen.getByText('search input')).not.toBeInTheDocument()
  await expect.element(knowledge).toHaveFocus()
  await userEvent.tab()
  await expect.element(screen.getByRole('button', { name: 'Using Weather forecast' })).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await expect.element(screen.getByText('weather input')).toBeVisible()
  await expect.element(screen.getByText('weather output')).toBeVisible()
  await userEvent.tab()
  await expect.element(screen.getByRole('button', { name: 'Using unlabelled' })).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  await expect.element(screen.getByText('pending input')).toBeVisible()
  await expect.element(screen.getByText('Response', { exact: true }).last()).toBeVisible()
  await screen.rerender(
    <>
      <button>Before tools</button>
      <Thought
        thought={{
          ...thought,
          observation: JSON.stringify(['search output', 'weather output', 'arrived output']),
        }}
        isFinished
      />
    </>,
  )
  await expect
    .element(screen.getByRole('button', { name: 'Used unlabelled' }))
    .toHaveAttribute('aria-expanded', 'true')
  await expect.element(screen.getByText('arrived output')).toBeVisible()
  await expect.element(screen.getByRole('button', { name: 'Used unlabelled' })).toHaveFocus()
})

it.each([
  {
    tool: 'invalid-json-{',
    tool_input: 'literal input',
    observation: 'literal output',
    label: 'invalid-json-{',
  },
  {
    tool: '{"name":"object-tool"}',
    tool_input: 'literal input',
    observation: 'literal output',
    label: '{"name":"object-tool"}',
  },
  {
    tool: '["search"]',
    tool_input: 'invalid-json-{',
    observation: 'invalid-json-[',
    label: 'search',
  },
])('keeps legacy non-array payloads readable for $label', async ({ label, ...payload }) => {
  const screen = await renderChat(
    <Thought thought={createChatThoughtFixture(payload)} isFinished />,
  )
  const toggle = screen.getByRole('button', { name: `Used ${label}` })
  await toggle.click()
  await expect.element(screen.getByText(payload.tool_input)).toBeVisible()
  await expect.element(screen.getByText(payload.observation)).toBeVisible()
  await toggle.click()
  await expect.element(screen.getByText(payload.tool_input)).not.toBeInTheDocument()
  await toggle.click()
  await expect.element(screen.getByText(payload.observation)).toBeVisible()
})
