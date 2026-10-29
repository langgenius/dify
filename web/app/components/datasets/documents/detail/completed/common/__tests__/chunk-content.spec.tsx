import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { ChunkingMode } from '@/models/datasets'
import ChunkContent from '../chunk-content'

it('edits question and answer independently through their labeled fields', async () => {
  const user = userEvent.setup()
  const onQuestionChange = vi.fn()
  const onAnswerChange = vi.fn()
  function Harness() {
    const [question, setQuestion] = useState('Question')
    const [answer, setAnswer] = useState('Answer')
    return (
      <ChunkContent
        docForm={ChunkingMode.qa}
        question={question}
        answer={answer}
        isEditMode
        onQuestionChange={(value) => {
          setQuestion(value)
          onQuestionChange(value)
        }}
        onAnswerChange={(value) => {
          setAnswer(value)
          onAnswerChange(value)
        }}
      />
    )
  }
  render(<Harness />)
  await user.type(screen.getByRole('textbox', { name: 'QUESTION' }), ' updated')
  expect(onQuestionChange).toHaveBeenLastCalledWith('Question updated')
  expect(onAnswerChange).not.toHaveBeenCalled()
  await user.type(screen.getByRole('textbox', { name: 'ANSWER' }), ' updated')
  expect(onAnswerChange).toHaveBeenLastCalledWith('Answer updated')
  expect(screen.getByRole('textbox', { name: 'QUESTION' })).toHaveValue('Question updated')
})
