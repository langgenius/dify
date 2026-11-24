import type { TagResponse } from '@dify/contracts/api/console/tags/types.gen'
import type { ReactElement } from 'react'
import { render } from 'vitest-browser-react'
import { AppToaster } from '@/app/notifications/app-toaster'
import { createConsoleQueryWrapper } from '@/test/console/query-data'
import { seedTags } from '@/test/console/tags'

export async function renderWithTags(
  ui: ReactElement,
  tags: TagResponse[] | undefined,
  workspacePermissionKeys = ['app.tag.manage', 'dataset.tag.manage', 'snippets.create_and_modify'],
) {
  const { wrapper: Wrapper, queryClient } = createConsoleQueryWrapper({ workspacePermissionKeys })
  if (tags) seedTags(queryClient, tags)
  return {
    ...(await render(
      <Wrapper>
        {ui}
        <AppToaster />
      </Wrapper>,
    )),
    queryClient,
  }
}
