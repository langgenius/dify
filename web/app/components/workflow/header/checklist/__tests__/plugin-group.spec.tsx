import type { ChecklistItem } from '../../../hooks/use-checklist'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { Popover, PopoverContent } from '@/app/components/base/ui/popover'
import { useStore as usePluginDependencyStore } from '../../../plugin-dependency/store'
import { BlockEnum } from '../../../types'
import { ChecklistPluginGroup } from '../plugin-group'

const createChecklistItem = (overrides: Partial<ChecklistItem> = {}): ChecklistItem => ({
  id: 'node-1',
  type: BlockEnum.Tool,
  title: 'Tool Node',
  errorMessages: [],
  canNavigate: false,
  isPluginMissing: true,
  pluginUniqueIdentifier: 'langgenius/test-plugin:1.0.0@sha256',
  ...overrides,
})

describe('ChecklistPluginGroup', () => {
  const getInstallButton = () => {
    return screen.getByText('workflow.nodes.agent.pluginInstaller.install').closest('button') as HTMLButtonElement
  }

  const renderInPopover = (items: ChecklistItem[]) => {
    return render(
      <Popover open>
        <PopoverContent>
          <ChecklistPluginGroup items={items} />
        </PopoverContent>
      </Popover>,
    )
  }

  beforeEach(() => {
    usePluginDependencyStore.setState({ dependencies: [] })
  })

  it('should set marketplace dependencies when install button is clicked', () => {
    const items: ChecklistItem[] = [
      createChecklistItem({ id: 'node-1', pluginUniqueIdentifier: 'langgenius/test-plugin:1.0.0@sha256' }),
      createChecklistItem({ id: 'node-2', pluginUniqueIdentifier: 'langgenius/test-plugin:1.0.0@sha256' }),
      createChecklistItem({ id: 'node-3', pluginUniqueIdentifier: 'langgenius/another-plugin:2.0.0@sha256' }),
    ]

    renderInPopover(items)

    fireEvent.click(getInstallButton())

    expect(usePluginDependencyStore.getState().dependencies).toEqual([
      {
        type: 'marketplace',
        value: {
          marketplace_plugin_unique_identifier: 'langgenius/test-plugin:1.0.0@sha256',
          plugin_unique_identifier: 'langgenius/test-plugin:1.0.0@sha256',
          version: '1.0.0',
        },
      },
      {
        type: 'marketplace',
        value: {
          marketplace_plugin_unique_identifier: 'langgenius/another-plugin:2.0.0@sha256',
          plugin_unique_identifier: 'langgenius/another-plugin:2.0.0@sha256',
          version: '2.0.0',
        },
      },
    ])
  })

  it('should keep install button disabled when no identifier is available', () => {
    renderInPopover([createChecklistItem({ pluginUniqueIdentifier: undefined })])

    const installButton = getInstallButton()
    expect(installButton).toBeDisabled()

    fireEvent.click(installButton)
    expect(usePluginDependencyStore.getState().dependencies).toEqual([])
  })

  it('should omit the version when the marketplace identifier does not include one', () => {
    renderInPopover([createChecklistItem({ pluginUniqueIdentifier: 'langgenius/test-plugin@sha256' })])

    fireEvent.click(getInstallButton())

    expect(usePluginDependencyStore.getState().dependencies).toEqual([
      {
        type: 'marketplace',
        value: {
          marketplace_plugin_unique_identifier: 'langgenius/test-plugin@sha256',
          plugin_unique_identifier: 'langgenius/test-plugin@sha256',
          version: undefined,
        },
      },
    ])
  })
})
