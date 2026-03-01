import type { HumanInputFormData } from '@/types/workflow'
import { render, screen } from '@testing-library/react'
import { DeliveryMethodType } from '@/app/components/workflow/nodes/human-input/types'
import HumanInputFormList from './human-input-form-list'

// Mock child components
vi.mock('./human-input-content/content-wrapper', () => ({
  default: ({ children, nodeTitle }: { children: React.ReactNode, nodeTitle: string }) => (
    <div data-testid="content-wrapper" data-nodetitle={nodeTitle}>
      {children}
    </div>
  ),
}))

vi.mock('./human-input-content/unsubmitted', () => ({
  UnsubmittedHumanInputContent: ({ showEmailTip, isEmailDebugMode, showDebugModeTip }: { showEmailTip: boolean, isEmailDebugMode: boolean, showDebugModeTip: boolean }) => (
    <div data-testid="unsubmitted-content">
      <span data-testid="email-tip">{showEmailTip ? 'true' : 'false'}</span>
      <span data-testid="email-debug">{isEmailDebugMode ? 'true' : 'false'}</span>
      <span data-testid="debug-tip">{showDebugModeTip ? 'true' : 'false'}</span>
    </div>
  ),
}))

describe('HumanInputFormList', () => {
  const mockFormData = [
    {
      form_id: 'form1',
      node_id: 'node1',
      node_title: 'Title 1',
      display_in_ui: true,
    },
    {
      form_id: 'form2',
      node_id: 'node2',
      node_title: 'Title 2',
      display_in_ui: false,
    },
  ]

  const mockGetNodeData = vi.fn()

  it('should render empty list when no form data is provided', () => {
    render(<HumanInputFormList humanInputFormDataList={[]} />)
    expect(screen.getByTestId('human-input-form-list')).toBeEmptyDOMElement()
  })

  it('should render only items with display_in_ui set to true', () => {
    mockGetNodeData.mockReturnValue({
      data: {
        delivery_methods: [],
      },
    })
    render(
      <HumanInputFormList
        humanInputFormDataList={mockFormData as HumanInputFormData[]}
        getHumanInputNodeData={mockGetNodeData}
      />,
    )
    const items = screen.getAllByTestId('human-input-form-item')
    expect(items).toHaveLength(1)
    expect(screen.getByTestId('content-wrapper')).toHaveAttribute('data-nodetitle', 'Title 1')
  })

  describe('Delivery Methods Config', () => {
    it('should set default tips when node data is not found', () => {
      mockGetNodeData.mockReturnValue(undefined)
      render(
        <HumanInputFormList
          humanInputFormDataList={[mockFormData[0]] as HumanInputFormData[]}
          getHumanInputNodeData={mockGetNodeData}
        />,
      )
      expect(screen.getByTestId('email-tip')).toHaveTextContent('false')
      expect(screen.getByTestId('email-debug')).toHaveTextContent('false')
      expect(screen.getByTestId('debug-tip')).toHaveTextContent('false')
    })

    it('should set default tips when delivery_methods is empty', () => {
      mockGetNodeData.mockReturnValue({ data: { delivery_methods: [] } })
      render(
        <HumanInputFormList
          humanInputFormDataList={[mockFormData[0]] as HumanInputFormData[]}
          getHumanInputNodeData={mockGetNodeData}
        />,
      )
      expect(screen.getByTestId('email-tip')).toHaveTextContent('false')
      expect(screen.getByTestId('email-debug')).toHaveTextContent('false')
      expect(screen.getByTestId('debug-tip')).toHaveTextContent('false')
    })

    it('should show tips correctly based on delivery methods', () => {
      mockGetNodeData.mockReturnValue({
        data: {
          delivery_methods: [
            { type: DeliveryMethodType.WebApp, enabled: true },
            { type: DeliveryMethodType.Email, enabled: true, config: { debug_mode: true } },
          ],
        },
      })
      render(
        <HumanInputFormList
          humanInputFormDataList={[mockFormData[0]] as HumanInputFormData[]}
          getHumanInputNodeData={mockGetNodeData}
        />,
      )
      expect(screen.getByTestId('email-tip')).toHaveTextContent('true')
      expect(screen.getByTestId('email-debug')).toHaveTextContent('true')
      expect(screen.getByTestId('debug-tip')).toHaveTextContent('false') // WebApp is enabled
    })

    it('should show debug mode tip if WebApp is disabled', () => {
      mockGetNodeData.mockReturnValue({
        data: {
          delivery_methods: [
            { type: DeliveryMethodType.WebApp, enabled: false },
            { type: DeliveryMethodType.Email, enabled: false },
          ],
        },
      })
      render(
        <HumanInputFormList
          humanInputFormDataList={[mockFormData[0]] as HumanInputFormData[]}
          getHumanInputNodeData={mockGetNodeData}
        />,
      )
      expect(screen.getByTestId('email-tip')).toHaveTextContent('false')
      expect(screen.getByTestId('debug-tip')).toHaveTextContent('true')
    })
  })
})
