import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { ChatContext } from '@/app/components/base/chat/chat/context'
import MarkdownForm from '../form'

it('blocks chat submission for a cleared required picker and sends the confirmed civil date', async () => {
  vi.setSystemTime(new Date('2025-01-15T12:00:00Z'))
  const onSend = vi.fn()
  try {
    const screen = await render(
      // oxlint-disable-next-line eslint-react/no-context-provider -- use-context-selector requires its custom Provider.
      <ChatContext.Provider value={{ chatList: [], onSend }}>
        <MarkdownForm
          node={{
            type: 'element',
            tagName: 'form',
            properties: { dataFormat: 'json' },
            children: [
              {
                type: 'element',
                tagName: 'label',
                properties: { for: 'departure' },
                children: [{ type: 'text', value: 'Departure' }],
              },
              {
                type: 'element',
                tagName: 'input',
                properties: {
                  type: 'date',
                  name: 'departure',
                  required: true,
                  value: '2025-01-15',
                },
                children: [],
              },
              {
                type: 'element',
                tagName: 'button',
                properties: {},
                children: [{ type: 'text', value: 'Submit booking' }],
              },
            ],
          }}
        />
      </ChatContext.Provider>,
    )
    await screen.getByRole('button', { name: 'common.operation.clear' }).click()
    await screen.getByRole('button', { name: 'Submit booking' }).click()
    expect(onSend).not.toHaveBeenCalled()
    const trigger = screen.getByRole('button', { name: 'Departure' })
    await expect.element(trigger).toHaveFocus()
    await expect.element(trigger).toHaveAttribute('aria-invalid', 'true')
    await expect.element(trigger).toHaveAccessibleDescription(/time.picker.required/)
    await userEvent.keyboard('{Enter}')
    await expect.element(screen.getByRole('dialog', { name: 'Departure' })).toBeVisible()
    await userEvent.keyboard('{Enter}')
    await expect
      .element(screen.getByRole('button', { name: 'Departure Jan 15, 2025' }))
      .toHaveFocus()
    await screen.getByRole('button', { name: 'Submit booking' }).click()
    expect(onSend).toHaveBeenCalledExactlyOnceWith('{"departure":"2025-01-15"}')
  } finally {
    vi.useRealTimers()
  }
})
