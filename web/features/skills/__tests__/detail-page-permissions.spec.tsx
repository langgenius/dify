import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vite-plus/test'
import {
  createSkillDetail,
  getMocks,
  renderSkillDetailPage,
  resetDetailPageFixture,
} from './detail-page.fixture'

const mocks = getMocks()

describe('Skill detail delete permission', () => {
  beforeEach(resetDetailPageFixture)

  it.each(['user-1', 'user-2', null])(
    'uses maintainer %s for the delete menu',
    async (maintainer) => {
      mocks.permissionKeys = ['skill.edit']
      mocks.skillDetail = createSkillDetail({ maintainer })
      const user = userEvent.setup()
      renderSkillDetailPage()
      await user.click(
        await screen.findByRole('button', {
          name: 'skill.skillManagement.moreActions:{"name":"Untitled skill"}',
        }),
      )
      const action = screen.queryByRole('menuitem', { name: 'common.operation.delete' })
      if (maintainer === 'user-1') expect(action).toBeVisible()
      else expect(action).not.toBeInTheDocument()
    },
  )
})
