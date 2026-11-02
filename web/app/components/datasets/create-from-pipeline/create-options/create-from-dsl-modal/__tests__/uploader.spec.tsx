import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import Uploader from '../uploader'

it('selects a pipeline file, displays its name and removes it', async () => {
  const user = userEvent.setup()
  const Harness = () => {
    const [file, setFile] = useState<File>()
    return <Uploader file={file} updateFile={setFile} />
  }
  render(<Harness />)
  // The browser file-picker input is hidden and has no accessible label.
  const input = document.getElementById('fileUploader') as HTMLInputElement
  const file = new File(['pipeline content'], 'documents.pipeline')
  await user.upload(input, file)
  expect(screen.getByText('documents.pipeline')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'app.dslUploader.browse' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'common.operation.remove' }))
  expect(screen.queryByText('documents.pipeline')).not.toBeInTheDocument()
  expect(input).toHaveValue('')
  expect(screen.getByRole('button', { name: 'app.dslUploader.browse' })).toBeInTheDocument()
})
