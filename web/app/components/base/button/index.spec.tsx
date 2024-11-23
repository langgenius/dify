import React from 'react'
import { cleanup, fireEvent, render } from '@testing-library/react'
import Button from './index'

afterEach(cleanup)
// https://testing-library.com/docs/queries/about
describe('Button text', () => {
  test('Button text should be same as children', async () => {
    const { getByRole, container } = render(<Button>Click me</Button>)
    expect(getByRole('button').textContent).toBe('Click me')
    expect(container.querySelector('button')?.textContent).toBe('Click me')
  })

  test('Loading button text should include  same as children', async () => {
    const { getByRole } = render(<Button loading>Click me</Button>)
    expect(getByRole('button').textContent?.includes('Loading')).toBe(true)
  })
})

describe('Button style', () => {
  test('Button should have default variant', async () => {
    const { getByRole } = render(<Button>Click me</Button>)
    expect(getByRole('button').className).toContain('btn-secondary')
  })

  test('Button should have primary variant', async () => {
    const { getByRole } = render(<Button variant='primary'>Click me</Button>)
    expect(getByRole('button').className).toContain('btn-primary')
  })

  test('Button should have warning variant', async () => {
    const { getByRole } = render(<Button variant='warning'>Click me</Button>)
    expect(getByRole('button').className).toContain('btn-warning')
  })

  test('Button disabled should have disabled variant', async () => {
    const { getByRole } = render(<Button disabled>Click me</Button>)
    expect(getByRole('button').className).toContain('btn-disabled')
  })
})

describe('Button events', () => {
  test('onClick should been call after clicked', async () => {
    const onClick = jest.fn()
    const { getByRole } = render(<Button onClick={onClick}>Click me</Button>)
    fireEvent.click(getByRole('button'))
    expect(onClick).toHaveBeenCalled()
  })
})
