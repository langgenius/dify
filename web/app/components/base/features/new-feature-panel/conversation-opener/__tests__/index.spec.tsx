import type { Features, OnFeaturesChange } from '../../../types'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { replacePromptEditorText } from '@/app/components/base/prompt-editor/plugins/__tests__/test-helpers'
import { renderWithConfigurationModals } from '@/test/configuration-modals'
import ConversationOpener from '../index'

const renderOpener = (
  opening: Features['opening'] = { enabled: false },
  props: { disabled?: boolean; onChange?: OnFeaturesChange } = {},
) =>
  renderWithConfigurationModals(<ConversationOpener {...props} />, {
    initialFeatures: { opening },
  })

const openSettings = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.hover(screen.getByText('appDebug.feature.conversationOpener.title'))
  const edit = screen.getByRole('button', { name: 'appDebug.openingStatement.writeOpener' })
  edit.focus()
  await user.click(edit)
  return screen.findByRole('dialog', { name: 'appDebug.feature.conversationOpener.title' })
}

describe('ConversationOpener', () => {
  it('enables the opener and shows its empty statement placeholder', async () => {
    const user = userEvent.setup({ skipHover: true })
    const { featuresStore } = renderOpener()
    expect(screen.getByText('appDebug.feature.conversationOpener.description')).toBeInTheDocument()
    await user.click(screen.getByRole('switch'))
    expect(screen.getByRole('switch')).toBeChecked()
    await user.unhover(screen.getByText('appDebug.feature.conversationOpener.title'))
    expect(screen.getByText('appDebug.openingStatement.placeholderLine1')).toBeInTheDocument()
    expect(featuresStore.getState().features.opening).toEqual({ enabled: true })
  })

  it('saves the edited statement through the real modal and displays it on the feature card', async () => {
    const user = userEvent.setup({ skipHover: true })
    const { featuresStore } = renderOpener({ enabled: true, opening_statement: 'Hello' })
    expect(screen.getByText('Hello')).toBeInTheDocument()
    const dialog = await openSettings(user)
    expect(within(dialog).getByRole('textbox')).toHaveTextContent('Hello')
    await replacePromptEditorText(within(dialog).getByRole('textbox'), 'Updated')
    await user.click(within(dialog).getByRole('button', { name: 'common.operation.save' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await user.hover(screen.getByText('appDebug.feature.conversationOpener.title'))
    await user.unhover(screen.getByText('appDebug.feature.conversationOpener.title'))
    expect(screen.getByText('Updated')).toBeInTheDocument()
    expect(featuresStore.getState().features.opening).toMatchObject({
      enabled: true,
      opening_statement: 'Updated',
    })
  })

  it('discards unsaved edits when the modal is cancelled', async () => {
    const user = userEvent.setup({ skipHover: true })
    const { featuresStore } = renderOpener({ enabled: true, opening_statement: 'Hello' })
    const dialog = await openSettings(user)
    await replacePromptEditorText(within(dialog).getByRole('textbox'), 'Discard this')
    await user.click(within(dialog).getByRole('button', { name: 'common.operation.cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await user.hover(screen.getByText('appDebug.feature.conversationOpener.title'))
    await user.unhover(screen.getByText('appDebug.feature.conversationOpener.title'))
    expect(screen.getByText('Hello')).toBeInTheDocument()
    expect(featuresStore.getState().features.opening).toEqual({
      enabled: true,
      opening_statement: 'Hello',
    })
  })

  it('keeps the opener settings closed when editing is disabled', async () => {
    const user = userEvent.setup({ skipHover: true })
    const { featuresStore } = renderOpener(
      { enabled: true, opening_statement: 'Hello' },
      { disabled: true },
    )
    await user.hover(screen.getByText('appDebug.feature.conversationOpener.title'))
    const edit = screen.getByRole('button', { name: 'appDebug.openingStatement.writeOpener' })
    expect(edit).toBeDisabled()
    await user.click(edit)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(featuresStore.getState().features.opening).toEqual({
      enabled: true,
      opening_statement: 'Hello',
    })
  })
})
