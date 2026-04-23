import type { ToolWithProvider } from '../../types'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CollectionType } from '../../../tools/types'
import IndexBar, {
  CUSTOM_GROUP_NAME,
  DATA_SOURCE_GROUP_NAME,
  groupItems,
  WORKFLOW_GROUP_NAME,
} from '../index-bar'

const createToolProvider = (overrides: Partial<ToolWithProvider> = {}): ToolWithProvider => ({
  id: 'provider-1',
  name: 'Provider 1',
  author: 'Author',
  description: { en_US: 'desc', zh_Hans: '描述' },
  icon: 'icon',
  label: { en_US: 'Alpha', zh_Hans: '甲' },
  type: CollectionType.builtIn,
  team_credentials: {},
  is_team_authorization: false,
  allow_delete: false,
  labels: [],
  tools: [],
  meta: { version: '1.0.0' },
  ...overrides,
})

describe('IndexBar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Grouping should normalize Chinese initials, custom groups, and hash ordering.
  describe('groupItems', () => {
    it('should group providers by first letter and move hash to the end', () => {
      const items: ToolWithProvider[] = [
        createToolProvider({
          id: 'alpha',
          label: { en_US: 'Alpha', zh_Hans: '甲' },
          type: CollectionType.builtIn,
          author: 'Builtin',
        }),
        createToolProvider({
          id: 'custom',
          label: { en_US: '1Custom', zh_Hans: '1自定义' },
          type: CollectionType.custom,
          author: 'Custom',
        }),
        createToolProvider({
          id: 'workflow',
          label: { en_US: '中文工作流', zh_Hans: '中文工作流' },
          type: CollectionType.workflow,
          author: 'Workflow',
        }),
        createToolProvider({
          id: 'source',
          label: { en_US: 'Data Source', zh_Hans: '数据源' },
          type: CollectionType.datasource,
          author: 'Data',
        }),
      ]

      const result = groupItems(items, item => item.label.zh_Hans[0] || item.label.en_US[0] || '')

      expect(result.letters).toEqual(['J', 'S', 'Z', '#'])
      expect(result.groups.J!.Builtin).toHaveLength(1)
      expect(result.groups.Z![WORKFLOW_GROUP_NAME]).toHaveLength(1)
      expect(result.groups.S![DATA_SOURCE_GROUP_NAME]).toHaveLength(1)
      expect(result.groups['#']![CUSTOM_GROUP_NAME]).toHaveLength(1)
    })
  })

  // Clicking a letter should scroll the matching section into view.
  describe('Rendering', () => {
    it('should call scrollIntoView for the selected letter', async () => {
      const user = userEvent.setup()
      const scrollIntoView = vi.fn()
      const itemRefs = {
        current: {
          A: { scrollIntoView } as unknown as HTMLElement,
        },
      }

      render(
        <IndexBar
          letters={['A']}
          itemRefs={itemRefs}
        />,
      )

      await user.click(screen.getByText('A'))

      expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth' })
    })
  })
})
