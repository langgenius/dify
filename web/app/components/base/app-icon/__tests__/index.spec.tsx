import { render, screen } from '@testing-library/react'
import AppIcon from '..'

it('resolves persisted emoji IDs and treats identity beside text as decorative', () => {
  render(<AppIcon icon={{ icon_type: 'emoji', icon: 'robot_face', icon_background: '#FFEAD5' }} />)
  expect(screen.getByText('🤖')).toBeInTheDocument()
  expect(screen.queryByRole('img')).not.toBeInTheDocument()
})

it('does not use an uploaded file ID as a URL or emoji when its resolved URL is missing', () => {
  const { container } = render(<AppIcon icon={{ icon_type: 'image', icon: 'uploaded-file-id' }} />)
  expect(screen.getByText('🤖')).toBeInTheDocument()
  expect(container.querySelector('img')).not.toBeInTheDocument()
  expect(screen.queryByText('uploaded-file-id')).not.toBeInTheDocument()
})
