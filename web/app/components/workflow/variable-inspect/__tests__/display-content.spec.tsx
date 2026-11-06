import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { DisplayContent } from '../display-content'
import { PreviewType } from '../types'

it('previews edited markdown and preserves it when returning to code view', async () => {
  const user = userEvent.setup()
  function Editor() {
    const [text, setText] = useState('Original content')
    return (
      <DisplayContent
        previewType={PreviewType.Markdown}
        varType="string"
        mdString={text}
        readonly={false}
        handleTextChange={setText}
      />
    )
  }
  render(<Editor />)
  const input = screen.getByRole('textbox', {
    name: 'workflowDebug.debug.variableInspect.markdownContent',
  })
  await user.clear(input)
  await user.type(input, '# Updated content')
  await user.click(screen.getByRole('radio', { name: 'workflow.common.preview' }))
  expect(await screen.findByRole('heading', { name: 'Updated content' })).toBeVisible()
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()

  await user.click(screen.getByRole('radio', { name: 'workflow.nodes.templateTransform.code' }))
  expect(screen.getByRole('textbox')).toHaveValue('# Updated content')
})
