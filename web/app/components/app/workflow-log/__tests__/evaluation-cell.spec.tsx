import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import EvaluationCell from '../evaluation-cell'

describe('EvaluationCell', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Rendering', () => {
    it('should render a placeholder when evaluation data is empty', () => {
      render(<EvaluationCell evaluation={[]} />)

      expect(screen.getByText('-')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'appLog.table.header.evaluation' })).not.toBeInTheDocument()
    })

    it('should render a placeholder when evaluation data is missing', () => {
      render(<EvaluationCell />)

      expect(screen.getByText('-')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'appLog.table.header.evaluation' })).not.toBeInTheDocument()
    })

    it('should render a placeholder when evaluation data is null', () => {
      render(<EvaluationCell evaluation={null} />)

      expect(screen.getByText('-')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'appLog.table.header.evaluation' })).not.toBeInTheDocument()
    })

    it('should render a trigger button when evaluation data is available', () => {
      render(
        <EvaluationCell
          evaluation={[{
            name: 'Faithfulness',
            value: 0.98,
          }]}
        />,
      )

      expect(screen.getByRole('button', { name: 'appLog.table.header.evaluation' })).toBeInTheDocument()
    })
  })

  describe('Interactions', () => {
    it('should render evaluation details when clicking the trigger', async () => {
      const user = userEvent.setup()

      render(
        <EvaluationCell
          evaluation={[{
            name: 'Faithfulness',
            value: 0.98,
            details: {
              stubbed: true,
              source: 'console-evaluation-run',
              value_type: 'number',
            },
            nodeInfo: {
              node_id: 'node-1',
              title: 'Knowledge Retrieval',
              type: 'knowledge-retrieval',
            },
          }]}
        />,
      )

      await user.click(screen.getByRole('button', { name: 'appLog.table.header.evaluation' }))

      expect(await screen.findByTestId('workflow-log-evaluation-popover')).toBeInTheDocument()
      expect(screen.getByText('Faithfulness')).toBeInTheDocument()
      expect(screen.getByText('0.98')).toBeInTheDocument()
      expect(screen.getByText('Knowledge Retrieval')).toBeInTheDocument()
    })

    it('should render boolean values using readable text', async () => {
      const user = userEvent.setup()

      render(
        <EvaluationCell
          evaluation={[{
            name: 'Correctness',
            value: true,
          }]}
        />,
      )

      await user.click(screen.getByRole('button', { name: 'appLog.table.header.evaluation' }))

      expect(await screen.findByText('True')).toBeInTheDocument()
    })

    it('should render evaluation items with null node info', async () => {
      const user = userEvent.setup()

      render(
        <EvaluationCell
          evaluation={[{
            name: 'custom_score',
            value: 0.95,
            details: {
              stubbed: true,
              source: 'console-evaluation-run',
              value_type: 'number',
              customized: true,
            },
            nodeInfo: null,
          }]}
        />,
      )

      await user.click(screen.getByRole('button', { name: 'appLog.table.header.evaluation' }))

      expect(await screen.findByText('custom_score')).toBeInTheDocument()
      expect(screen.getByText('0.95')).toBeInTheDocument()
    })
  })
})
