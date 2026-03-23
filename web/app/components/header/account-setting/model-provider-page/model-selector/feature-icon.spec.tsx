import { fireEvent, render, screen } from '@testing-library/react'
import {
  ModelFeatureEnum,
  ModelFeatureTextEnum,
} from '../declarations'
import FeatureIcon from './feature-icon'

describe('FeatureIcon', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should show feature label when showFeaturesLabel is true', () => {
    render(
      <>
        <FeatureIcon feature={ModelFeatureEnum.vision} showFeaturesLabel />
        <FeatureIcon feature={ModelFeatureEnum.document} showFeaturesLabel />
        <FeatureIcon feature={ModelFeatureEnum.audio} showFeaturesLabel />
        <FeatureIcon feature={ModelFeatureEnum.video} showFeaturesLabel />
      </>,
    )

    expect(screen.getByText(ModelFeatureTextEnum.vision)).toBeInTheDocument()
    expect(screen.getByText(ModelFeatureTextEnum.document)).toBeInTheDocument()
    expect(screen.getByText(ModelFeatureTextEnum.audio)).toBeInTheDocument()
    expect(screen.getByText(ModelFeatureTextEnum.video)).toBeInTheDocument()
  })

  it('should show tooltip content on hover when showFeaturesLabel is false', async () => {
    const cases: Array<{ feature: ModelFeatureEnum, text: string }> = [
      { feature: ModelFeatureEnum.vision, text: ModelFeatureTextEnum.vision },
      { feature: ModelFeatureEnum.document, text: ModelFeatureTextEnum.document },
      { feature: ModelFeatureEnum.audio, text: ModelFeatureTextEnum.audio },
      { feature: ModelFeatureEnum.video, text: ModelFeatureTextEnum.video },
    ]

    for (const { feature, text } of cases) {
      const { container, unmount } = render(<FeatureIcon feature={feature} />)
      fireEvent.mouseEnter(container.firstElementChild as HTMLElement)
      expect(await screen.findByText(`common.modelProvider.featureSupported:{"feature":"${text}"}`))
        .toBeInTheDocument()
      unmount()
    }
  })

  it('should render nothing for unsupported feature', () => {
    const { container } = render(<FeatureIcon feature={ModelFeatureEnum.toolCall} />)
    expect(container).toBeEmptyDOMElement()
  })
})
