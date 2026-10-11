import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import PipelineExportConfirmModal from '../export-confirm-modal'

it('keeps pipeline DSL copy and the explicit secret opt-in after separating app exports', async () => {
  const user = userEvent.setup()
  const onConfirm = vi.fn().mockResolvedValue(true)
  render(
    <PipelineExportConfirmModal
      isExporting={false}
      envList={[{ name: 'TOKEN', value: 'masked' }]}
      onConfirm={onConfirm}
      onClose={vi.fn()}
    />,
  )

  expect(screen.getByRole('alertdialog')).toHaveAccessibleName('workflow.env.export.title')
  expect(screen.getByRole('button', { name: 'workflow.env.export.ignore' })).toBeEnabled()
  await user.click(screen.getByRole('checkbox'))
  await user.click(screen.getByRole('button', { name: 'workflow.env.export.export' }))
  expect(onConfirm).toHaveBeenCalledExactlyOnceWith(true)
})
