import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ModifyExternalRetrievalModal from '../modify-external-retrieval-modal'

const props = { initialTopK: 4, initialScoreThreshold: 0.5, initialScoreThresholdEnabled: false }
it('saves edits to external retrieval together before closing', async () => {
  const user = userEvent.setup()
  const onSave = vi.fn()
  const onClose = vi.fn()
  render(<ModifyExternalRetrievalModal {...props} onSave={onSave} onClose={onClose} />)
  const topK = screen.getByRole('textbox', { name: 'appDebug.datasetConfig.top_k' })
  expect(topK).toHaveValue('4')
  await user.clear(topK)
  await user.type(topK, '10')
  await user.click(screen.getByRole('switch', { name: 'appDebug.datasetConfig.score_threshold' }))
  const score = screen.getByRole('textbox', { name: 'appDebug.datasetConfig.score_threshold' })
  await user.clear(score)
  await user.type(score, '0.9')
  expect(onSave).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'common.operation.save' }))
  expect(onSave).toHaveBeenCalledExactlyOnceWith({
    top_k: 10,
    score_threshold: 0.9,
    score_threshold_enabled: true,
  })
  expect(onClose).toHaveBeenCalledOnce()
})

it.each(['cancel', 'close'])('discards unsaved edits through %s', async (action) => {
  const user = userEvent.setup()
  const onSave = vi.fn()
  const onClose = vi.fn()
  render(<ModifyExternalRetrievalModal {...props} onSave={onSave} onClose={onClose} />)
  await user.type(screen.getByRole('textbox', { name: 'appDebug.datasetConfig.top_k' }), '0')
  await user.click(screen.getByRole('button', { name: `common.operation.${action}` }))
  expect(onClose).toHaveBeenCalledOnce()
  expect(onSave).not.toHaveBeenCalled()
})
