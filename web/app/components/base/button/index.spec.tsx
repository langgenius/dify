import React from 'react'
import { cleanup, fireEvent, render } from '@testing-library/react'
import Button from './index'

afterEach(cleanup)
// https://testing-library.com/docs/queries/about
describe('Button', () => {
  describe('Button text', () => {
    test('Button text should be same as children', async () => {
      const { getByRole, container } = render(<Button>Click me</Button>)
      expect(getByRole('button').textContent).toBe('Click me')
      expect(container.querySelector('button')?.textContent).toBe('Click me')
    })
  })

  describe('Button loading', () => {
    test('Loading button text should include same as children', async () => {
      const { getByRole } = render(<Button loading>Click me</Button>)
      expect(getByRole('button').textContent?.includes('Loading')).toBe(true)
    })
    test('Not loading button text should include same as children', async () => {
      const { getByRole } = render(<Button loading={false}>Click me</Button>)
      expect(getByRole('button').textContent?.includes('Loading')).toBe(false)
    })

    test('Loading button should have loading classname', async () => {
      const animClassName = 'anim-breath'
      const { getByRole } = render(<Button loading spinnerClassName={animClassName}>Click me</Button>)
      expect(getByRole('button').getElementsByClassName('animate-spin')[0]?.className).toContain(animClassName)
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

    test('Button should have secondary variant', async () => {
      const { getByRole } = render(<Button variant='secondary'>Click me</Button>)
      expect(getByRole('button').className).toContain('btn-secondary')
    })

    test('Button should have secondary-accent variant', async () => {
      const { getByRole } = render(<Button variant='secondary-accent'>Click me</Button>)
      expect(getByRole('button').className).toContain('btn-secondary-accent')
    })
    test('Button should have ghost variant', async () => {
      const { getByRole } = render(<Button variant='ghost'>Click me</Button>)
      expect(getByRole('button').className).toContain('btn-ghost')
    })
    test('Button should have ghost-accent variant', async () => {
      const { getByRole } = render(<Button variant='ghost-accent'>Click me</Button>)
      expect(getByRole('button').className).toContain('btn-ghost-accent')
    })

    test('Button disabled should have disabled variant', async () => {
      const { getByRole } = render(<Button disabled>Click me</Button>)
      expect(getByRole('button').className).toContain('btn-disabled')
    })
  })

  describe('Button size', () => {
    test('Button should have default size', async () => {
      const { getByRole } = render(<Button>Click me</Button>)
      expect(getByRole('button').className).toContain('btn-medium')
    })

    test('Button should have small size', async () => {
      const { getByRole } = render(<Button size='small'>Click me</Button>)
      expect(getByRole('button').className).toContain('btn-small')
    })

    test('Button should have medium size', async () => {
      const { getByRole } = render(<Button size='medium'>Click me</Button>)
      expect(getByRole('button').className).toContain('btn-medium')
    })

    test('Button should have large size', async () => {
      const { getByRole } = render(<Button size='large'>Click me</Button>)
      expect(getByRole('button').className).toContain('btn-large')
    })
  })

  describe('Button destructive', () => {
    test('Button should have destructive classname', async () => {
      const { getByRole } = render(<Button destructive>Click me</Button>)
      expect(getByRole('button').className).toContain('btn-destructive')
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
})
