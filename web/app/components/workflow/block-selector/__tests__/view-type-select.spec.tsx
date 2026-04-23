import { fireEvent, render } from '@testing-library/react'
import ViewTypeSelect, { ViewType } from '../view-type-select'

const getViewOptions = (container: HTMLElement) => {
  const options = container.firstElementChild?.children
  if (!options || options.length !== 2)
    throw new Error('Expected two view options')
  return [options[0] as HTMLDivElement, options[1] as HTMLDivElement]
}

describe('ViewTypeSelect', () => {
  it('should highlight the active view type', () => {
    const onChange = vi.fn()
    const { container } = render(
      <ViewTypeSelect
        viewType={ViewType.flat}
        onChange={onChange}
      />,
    )

    const [flatOption, treeOption] = getViewOptions(container)

    expect(flatOption)!.toHaveClass('bg-components-segmented-control-item-active-bg')
    expect(treeOption)!.toHaveClass('cursor-pointer')
  })

  it('should call onChange when switching to a different view type', () => {
    const onChange = vi.fn()
    const { container } = render(
      <ViewTypeSelect
        viewType={ViewType.flat}
        onChange={onChange}
      />,
    )

    const [, treeOption] = getViewOptions(container)
    fireEvent.click(treeOption!)

    expect(onChange).toHaveBeenCalledWith(ViewType.tree)
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('should ignore clicks on the current view type', () => {
    const onChange = vi.fn()
    const { container } = render(
      <ViewTypeSelect
        viewType={ViewType.tree}
        onChange={onChange}
      />,
    )

    const [, treeOption] = getViewOptions(container)
    fireEvent.click(treeOption!)

    expect(onChange).not.toHaveBeenCalled()
  })
})
