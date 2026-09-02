import { screen } from '@testing-library/react'
import { render } from '@/test/console/render'
import { ResearchAnswer } from '../results'

describe('ResearchAnswer', () => {
  it('keeps a later thought active after an earlier thought completes', async () => {
    const onCitationClick = vi.fn()
    render(
      <ResearchAnswer
        answer={'<think>First reasoning</think>\nInterim answer.\n<think>Second reasoning'}
        citationCount={0}
        onCitationClick={onCitationClick}
        researchTaskId="research-multiple-thoughts"
        streaming
      />,
    )

    expect(await screen.findByText(/chat\.thought/)).toBeInTheDocument()
    expect(await screen.findByText(/chat\.thinking/)).toHaveTextContent('(0.0s)')
  })

  it('keeps elapsed seconds out of the thought accessible name', async () => {
    const onCitationClick = vi.fn()
    render(
      <ResearchAnswer
        answer="<think>Active reasoning"
        citationCount={0}
        onCitationClick={onCitationClick}
        researchTaskId="research-accessible-thought"
        streaming
      />,
    )

    const summary = (await screen.findByText(/chat\.thinking/)).closest('summary')
    expect(summary).toHaveAccessibleName('common.chat.thinking')
    expect(summary).not.toHaveAccessibleName(/\d+\.\ds/)
  })

  it('resets the thought timer when the research task changes', async () => {
    const onCitationClick = vi.fn()
    const { rerender } = render(
      <ResearchAnswer
        answer="<think>Completed reasoning</think>\nCompleted answer."
        citationCount={0}
        onCitationClick={onCitationClick}
        researchTaskId="research-completed"
        streaming={false}
      />,
    )

    expect(await screen.findByText(/chat\.thought/)).toBeInTheDocument()

    rerender(
      <ResearchAnswer
        answer="<think>Active reasoning"
        citationCount={0}
        onCitationClick={onCitationClick}
        researchTaskId="research-active"
        streaming
      />,
    )

    expect(await screen.findByText(/chat\.thinking/)).toHaveTextContent('(0.0s)')
    expect(screen.queryByText(/chat\.thought/)).not.toBeInTheDocument()
  })
})
