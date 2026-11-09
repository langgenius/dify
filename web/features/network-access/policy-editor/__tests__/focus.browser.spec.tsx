import type { ComponentProps } from 'react'
import { userEvent } from 'vite-plus/test/browser'
import { render } from 'vitest-browser-react'
import { IpPolicyDialog } from '@/features/network-access/policy-editor'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { createDeferred } from '@/test/deferred'

const requests = vi.hoisted(() => ({
  currentIp: vi.fn<() => Promise<{ client_ip: string }>>(),
}))

vi.mock('@/service/console/browser', () => ({
  consoleBrowserLink: {
    call: (path: readonly string[]) => {
      if (path.join('.') === 'workspaces.current.networkAccessGroups.currentIp.get')
        return requests.currentIp()
      throw new Error(`Unexpected console request: ${path.join('.')}`)
    },
  },
}))

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>()
  const { createReactI18nextMock } = await import('@/test/i18n-mock')
  const { default: translations } = await import('@/i18n/locales/en-US/common.json')
  return { ...actual, ...createReactI18nextMock(translations) }
})

beforeEach(() => {
  requests.currentIp.mockReset()
})

async function renderEditor(props: Partial<ComponentProps<typeof IpPolicyDialog>> = {}) {
  const { queryClient, wrapper: ConsoleProvider } = createConsoleQueryWrapper()
  const screen = await render(
    <ConsoleProvider>
      <IpPolicyDialog open mode="edit" initialName="Office" onOpenChange={vi.fn()} {...props} />
    </ConsoleProvider>,
  )
  return { screen, queryClient }
}

// Chromium loses native focus when the focused row is removed; happy-dom cannot prove recovery.
it.each([0, 1])(
  'keeps keyboard navigation at the adjacent input after removing row %i',
  async (index) => {
    const { screen, queryClient } = await renderEditor({
      initialEntries: ['10.0.0.0/8', '203.0.113.42'],
      currentIp: '192.0.2.1',
    })

    try {
      const inputs = screen.getByRole('textbox', { name: 'Allowlist', exact: true }).all()
      await inputs[index]!.click()
      await userEvent.tab()
      await expect
        .element(screen.getByRole('button', { name: 'Remove entry', exact: true }).nth(index))
        .toHaveFocus()
      await userEvent.keyboard('{Enter}')

      const remaining = screen.getByRole('textbox', { name: 'Allowlist', exact: true })
      await expect.element(remaining).toHaveValue(index === 0 ? '203.0.113.42' : '10.0.0.0/8')
      await expect.element(remaining).toHaveFocus()
      await userEvent.tab()
      await expect
        .element(screen.getByRole('button', { name: 'Remove entry', exact: true }))
        .toHaveFocus()
      expect(requests.currentIp).not.toHaveBeenCalled()
    } finally {
      await screen.unmount()
      queryClient.clear()
    }
  },
)

// The retry button previously unmounted while loading, and Add it could become natively disabled.
// Real Chromium verifies focus through both transitions, including an already allowed address.
it.each([false, true])(
  'retains current-IP action focus through retry (already allowed: %s)',
  async (alreadyAllowed) => {
    const response = createDeferred<{ client_ip: string }>()
    requests.currentIp
      .mockRejectedValueOnce(new Error('IP unavailable'))
      .mockReturnValueOnce(response.promise)
    const { screen, queryClient } = await renderEditor()

    try {
      const retry = screen.getByRole('button', { name: 'Retry', exact: true })
      await expect.element(retry).toBeVisible()
      const input = screen.getByRole('textbox', { name: 'Allowlist', exact: true })
      await input.fill(alreadyAllowed ? '203.0.113.42' : '')
      await userEvent.tab()
      await expect
        .element(screen.getByRole('button', { name: 'Remove entry', exact: true }))
        .toHaveFocus()
      await userEvent.tab()
      await expect.element(screen.getByRole('button', { name: 'Add', exact: true })).toHaveFocus()
      await userEvent.tab()
      await expect.element(retry).toHaveFocus()
      await userEvent.keyboard('{Enter}')

      await expect.element(retry).toHaveAttribute('aria-disabled', 'true')
      await expect.element(retry).toHaveFocus()
      await expect.poll(() => requests.currentIp.mock.calls.length).toBe(2)
      await userEvent.keyboard('{Enter}')
      expect(requests.currentIp).toHaveBeenCalledTimes(2)

      response.resolve({ client_ip: '203.0.113.42' })
      const addCurrentIp = screen.getByRole('button', { name: 'Add it', exact: true })
      await expect.element(addCurrentIp).toHaveFocus()
      if (alreadyAllowed)
        await expect.element(addCurrentIp).toHaveAttribute('aria-disabled', 'true')
      else await expect.element(addCurrentIp).not.toHaveAttribute('aria-disabled', 'true')
      await expect.element(input).toHaveValue(alreadyAllowed ? '203.0.113.42' : '')

      if (!alreadyAllowed) {
        await userEvent.keyboard('{Enter}')
        await expect.element(input).toHaveValue('203.0.113.42')
        await expect.element(addCurrentIp).toHaveAttribute('aria-disabled', 'true')
        await expect.element(addCurrentIp).toHaveFocus()
      }
      await userEvent.tab()
      await expect
        .element(screen.getByRole('button', { name: 'Cancel', exact: true }))
        .toHaveFocus()
      expect(requests.currentIp).toHaveBeenCalledTimes(2)
    } finally {
      response.resolve({ client_ip: '203.0.113.42' })
      await screen.unmount()
      queryClient.clear()
    }
  },
)
