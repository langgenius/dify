import { fireEvent, render, screen } from '@testing-library/react'
import Sidebar, { AppCategories } from './sidebar'

vi.mock('@remixicon/react', () => ({
  RiStickyNoteAddLine: () => <span>sticky</span>,
  RiThumbUpLine: () => <span>thumb</span>,
}))
describe('Sidebar', () => {
  it('renders recommended and custom categories', () => {
    render(<Sidebar current={AppCategories.RECOMMENDED} categories={['Cat A', 'Cat B']} />)

    expect(screen.getByText('app.newAppFromTemplate.sidebar.Recommended')).toBeInTheDocument()
    expect(screen.getByText('Cat A')).toBeInTheDocument()
    expect(screen.getByText('Cat B')).toBeInTheDocument()
  })

  it('notifies callbacks when items are clicked', () => {
    const onClick = vi.fn()
    const onCreate = vi.fn()
    render(
      <Sidebar
        current="Cat A"
        categories={['Cat A']}
        onClick={onClick}
        onCreateFromBlank={onCreate}
      />,
    )

    fireEvent.click(screen.getByText('app.newAppFromTemplate.sidebar.Recommended'))
    expect(onClick).toHaveBeenCalledWith(AppCategories.RECOMMENDED)

    fireEvent.click(screen.getByText('Cat A'))
    expect(onClick).toHaveBeenCalledWith('Cat A')

    fireEvent.click(screen.getByText('app.newApp.startFromBlank'))
    expect(onCreate).toHaveBeenCalled()
  })
})
