import { Button } from '@langgenius/dify-ui/button'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import ToolSelector from '../index'

vi.mock('../components/tool-authorization-section', () => ({
  ToolAuthorizationSection: () => null,
}))
vi.mock('../components/tool-base-form', () => ({ ToolBaseForm: () => null }))
vi.mock('../components/tool-settings-panel', () => ({ ToolSettingsPanel: () => null }))

vi.mock('../hooks/use-tool-selector', () => ({
  useToolSelector: () => ({
    isShow: false,
    setIsShow: vi.fn(),
    isShowChooseTool: false,
    setIsShowChooseTool: vi.fn(),
    currType: 'settings',
    setCurrType: vi.fn(),
    currentProvider: undefined,
    currentTool: undefined,
    settingsFormSchemas: [],
    paramsFormSchemas: [],
    showTabSlider: false,
    userSettingsOnly: false,
    reasoningConfigOnly: false,
    manifestIcon: '',
    inMarketPlace: false,
    manifest: undefined,
    handleSelectTool: vi.fn(),
    handleSelectMultipleTool: vi.fn(),
    handleDescriptionChange: vi.fn(),
    handleSettingsFormChange: vi.fn(),
    handleParamsFormChange: vi.fn(),
    handleEnabledChange: vi.fn(),
    handleAuthorizationItemClick: vi.fn(),
    handleInstall: vi.fn(),
    settingsValue: {},
  }),
}))

describe('ToolSelector', () => {
  it('opens an unconfigured add-tool selector and restores focus when dismissed', async () => {
    const user = userEvent.setup()

    function Harness() {
      const [open, setOpen] = useState(false)
      return (
        <ToolSelector
          trigger={<Button>Add tool</Button>}
          controlledState={open}
          onControlledStateChange={setOpen}
          onSelect={vi.fn()}
          nodeOutputVars={[]}
          availableNodes={[]}
        />
      )
    }

    render(<Harness />)

    const trigger = screen.getByRole('button', { name: 'Add tool' })
    await user.click(trigger)

    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('plugin.detailPanel.toolSelector.title')).toBeInTheDocument()

    await user.keyboard('{Escape}')

    expect(screen.queryByText('plugin.detailPanel.toolSelector.title')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })
})
