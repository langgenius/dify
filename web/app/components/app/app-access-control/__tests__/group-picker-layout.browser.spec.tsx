import { render } from 'vitest-browser-react'
import { SubjectType } from '@/models/access-control'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { installFakeApi } from '@/test/fake-api'
import AddMemberOrGroupDialog from '../add-member-or-group-pop'

const groupName =
  'Research and development platform engineering operations team supporting international infrastructure and customer experience across all business divisions'
it('keeps a long group path between search and the next selectable row', async () => {
  const { wrapper: Providers } = createConsoleQueryWrapper()
  const screen = await render(
    <Providers>
      <AddMemberOrGroupDialog subjects={{ groups: [], members: [] }} onChange={() => {}} />
    </Providers>,
  )
  await screen.getByRole('button', { name: 'common.operation.add', exact: true }).click()
  await screen
    .getByRole('button', {
      name: 'app.accessControlDialog.operateGroupAndMember.expand',
      exact: true,
    })
    .click()

  await expect.element(screen.getByRole('button', { name: 'Child group 1' })).toBeVisible()
  const navigation = screen
    .getByRole('navigation', {
      name: 'app.accessControlDialog.operateGroupAndMember.allMembers',
    })
    .element()
  const text = document.createRange()
  text.selectNodeContents(screen.getByText(groupName, { exact: true }).element())
  const search = screen
    .getByRole('searchbox', {
      name: 'app.accessControlDialog.operateGroupAndMember.searchPlaceholder',
    })
    .element()
  const nextRow = screen.getByRole('button', { name: 'Child group 1' }).element()

  const lines = Array.from(text.getClientRects())
  expect(lines.length).toBeGreaterThan(0)
  for (const line of lines) {
    expect(line.top).toBeGreaterThanOrEqual(search.getBoundingClientRect().bottom)
    expect(line.bottom).toBeLessThanOrEqual(nextRow.getBoundingClientRect().top)
    expect(line.left).toBeGreaterThanOrEqual(navigation.getBoundingClientRect().left)
    expect(line.right).toBeLessThanOrEqual(navigation.getBoundingClientRect().right)
  }
})

beforeEach(() => {
  onTestFinished(
    installFakeApi({
      console: {
        enterprise: {
          webAppAuth: {
            searchForWhilteListCandidates: (input) => {
              const groupId = input?.query?.groupId
              return {
                currPage: 1,
                hasMore: false,
                subjects: [
                  {
                    subjectId: groupId ? 'nested' : 'group',
                    subjectType: SubjectType.GROUP,
                    groupData: {
                      id: groupId ? 'nested' : 'group',
                      name: groupId ? 'Child group' : groupName,
                      groupSize: 1,
                    },
                  },
                ],
              }
            },
          },
        },
      },
    }),
  )
})
