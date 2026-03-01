import { cleanup, fireEvent, render } from '@testing-library/react'
import * as React from 'react'
import Button from './index'

afterEach(cleanup)
// https://testing-library.com/docs/queries/about
describe('Button', () => {
  describe('Button text', () => {
    it('Button text should be same as children', async () => {
      const { getByRole, container } = render(<Button>Click me</Button>)
      expect(getByRole('button').textContent).toBe('Click me')
      expect(container.querySelector('button')?.textContent).toBe('Click me')
    })
  })

  describe('Button loading', () => {
    it('Loading button text should include same as children', async () => {
      const { getByRole } = render(<Button loading>Click me</Button>)
      expect(getByRole('button').textContent?.includes('Loading')).toBe(true)
    })
    it('Not loading button text should include same as children', async () => {
      const { getByRole } = render(<Button loading={false}>Click me</Button>)
      expect(getByRole('button').textContent?.includes('Loading')).toBe(false)
    })

    it('Loading button should have loading classname', async () => {
      const animClassName = 'anim-breath'
      const { getByRole } = render(<Button loading spinnerClassName={animClassName}>Click me</Button>)
      expect(getByRole('button').getElementsByClassName('animate-spin')[0]?.className).toContain(animClassName)
    })
  })

  describe('Button style', () => {
    it('Button should have default variant', async () => {
      const { getByRole } = render(<Button>Click me</Button>)
      expect(getByRole('button').className).toContain('btn-secondary')
    })

    it('Button should have primary variant', async () => {
      const { getByRole } = render(<Button variant="primary">Click me</Button>)
      expect(getByRole('button').className).toContain('btn-primary')
    })

    it('Button should have warning variant', async () => {
      const { getByRole } = render(<Button variant="warning">Click me</Button>)
      expect(getByRole('button').className).toContain('btn-warning')
    })

    it('Button should have secondary variant', async () => {
      const { getByRole } = render(<Button variant="secondary">Click me</Button>)
      expect(getByRole('button').className).toContain('btn-secondary')
    })

    it('Button should have secondary-accent variant', async () => {
      const { getByRole } = render(<Button variant="secondary-accent">Click me</Button>)
      expect(getByRole('button').className).toContain('btn-secondary-accent')
    })
    it('Button should have ghost variant', async () => {
      const { getByRole } = render(<Button variant="ghost">Click me</Button>)
      expect(getByRole('button').className).toContain('btn-ghost')
    })
    it('Button should have ghost-accent variant', async () => {
      const { getByRole } = render(<Button variant="ghost-accent">Click me</Button>)
      expect(getByRole('button').className).toContain('btn-ghost-accent')
    })

    it('Button disabled should have disabled variant', async () => {
      const { getByRole } = render(<Button disabled>Click me</Button>)
      expect(getByRole('button').className).toContain('btn-disabled')
    })
  })

  describe('Button size', () => {
    it('Button should have default size', async () => {
      const { getByRole } = render(<Button>Click me</Button>)
      expect(getByRole('button').className).toContain('btn-medium')
    })

    it('Button should have small size', async () => {
      const { getByRole } = render(<Button size="small">Click me</Button>)
      expect(getByRole('button').className).toContain('btn-small')
    })

    it('Button should have medium size', async () => {
      const { getByRole } = render(<Button size="medium">Click me</Button>)
      expect(getByRole('button').className).toContain('btn-medium')
    })

    it('Button should have large size', async () => {
      const { getByRole } = render(<Button size="large">Click me</Button>)
      expect(getByRole('button').className).toContain('btn-large')
    })
  })

  describe('Button destructive', () => {
    it('Button should have destructive classname', async () => {
      const { getByRole } = render(<Button destructive>Click me</Button>)
      expect(getByRole('button').className).toContain('btn-destructive')
    })
  })

  describe('Button events', () => {
    it('onClick should been call after clicked', async () => {
      const onClick = vi.fn()
      const { getByRole } = render(<Button onClick={onClick}>Click me</Button>)
      fireEvent.click(getByRole('button'))
      expect(onClick).toHaveBeenCalled()
    })
  })
})
