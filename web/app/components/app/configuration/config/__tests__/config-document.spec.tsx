import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FeaturesContext } from '@/app/components/base/features/context'
import { createFeaturesStore } from '@/app/components/base/features/store'
import { SupportUploadFileTypes } from '@/app/components/workflow/types'
import { renderWithDebugConfiguration } from '@/test/debug-configuration'
import ConfigDocument from '../config-document'

function renderConfig(allowedTypes: SupportUploadFileTypes[], isVisible = true) {
  const store = createFeaturesStore({
    features: { file: { allowed_file_types: allowedTypes, enabled: allowedTypes.length > 0 } },
  })
  renderWithDebugConfiguration(
    <FeaturesContext.Provider value={store}>
      <ConfigDocument />
    </FeaturesContext.Provider>,
    { isShowDocumentConfig: isVisible },
  )
  return store
}

describe('ConfigDocument', () => {
  it('hides unavailable configuration', () => {
    renderConfig([], false)
    expect(screen.queryByRole('switch')).not.toBeInTheDocument()
  })

  it.each([{ remainingTypes: [] }, { remainingTypes: [SupportUploadFileTypes.audio] }])(
    'toggles document without losing the other upload types (%j)',
    async ({ remainingTypes }) => {
      const user = userEvent.setup()
      const store = renderConfig(remainingTypes)
      const toggle = screen.getByRole('switch')
      expect(toggle).not.toBeChecked()
      await user.click(toggle)
      expect(toggle).toBeChecked()
      expect(store.getState().features.file).toMatchObject({
        allowed_file_types: [...remainingTypes, SupportUploadFileTypes.document],
        enabled: true,
      })
      await user.click(toggle)
      expect(toggle).not.toBeChecked()
      expect(store.getState().features.file).toMatchObject({
        allowed_file_types: remainingTypes,
        enabled: remainingTypes.length > 0,
      })
    },
  )
})
