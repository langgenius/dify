import { render } from 'vitest-browser-react'
import { SelectedGroupsBreadcrumb } from '../add-member-or-group-pop/breadcrumb'

vi.mock('react-i18next', async () => {
  const { createReactI18nextMock } = await import('@/test/i18n-mock')
  return createReactI18nextMock({
    'app.accessControlDialog.operateGroupAndMember.allMembers': 'All members',
  })
})

it('keeps full group names visible within the member picker and ancestors usable', async () => {
  const groups = [
    { id: 'engineering', name: 'Platform engineering', groupSize: 1 },
    {
      id: 'research',
      name: 'Research and development platform engineering operations team',
      groupSize: 1,
    },
  ]
  const onChange = vi.fn()
  const screen = await render(
    <div style={{ width: 400, overflow: 'hidden' }}>
      <SelectedGroupsBreadcrumb groups={groups} onChange={onChange} />
    </div>,
  )
  const navigation = screen.getByRole('navigation').element()
  const bounds = navigation.getBoundingClientRect()
  for (const group of groups) {
    const text = document.createRange()
    text.selectNodeContents(screen.getByText(group.name, { exact: true }).element())
    for (const line of text.getClientRects()) {
      expect(line.right).toBeLessThanOrEqual(bounds.right)
      expect(line.bottom).toBeLessThanOrEqual(bounds.bottom)
    }
  }
  expect(navigation.scrollWidth).toBeLessThanOrEqual(navigation.clientWidth)
  await screen.getByRole('button', { name: groups[0]!.name }).click()
  expect(onChange).toHaveBeenLastCalledWith([groups[0]])
})
