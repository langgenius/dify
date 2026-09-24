import { render, screen } from '@testing-library/react'
import InstructionEditor from '../instruction-editor'
import { GeneratorType } from '../types'

describe('InstructionEditor accessibility', () => {
  it('names the editable textbox with its visible instruction label', () => {
    render(
      <>
        <div id="instruction-label">Visible instructions</div>
        <InstructionEditor
          aria-labelledby="instruction-label"
          editorKey="instructions"
          value=""
          onChange={vi.fn()}
          generatorType={GeneratorType.prompt}
          availableVars={[]}
          availableNodes={[]}
          isShowCurrentBlock={false}
          isShowLastRunBlock={false}
        />
      </>,
    )
    expect(screen.getByRole('textbox', { name: 'Visible instructions' })).toBeInTheDocument()
  })
})
