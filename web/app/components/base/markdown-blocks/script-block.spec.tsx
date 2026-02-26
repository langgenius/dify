import { cleanup, render } from '@testing-library/react'
import * as React from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import ScriptBlock from './script-block'

afterEach(() => {
  cleanup()
})

type ScriptNode = {
  children: Array<{ value?: string }>
}

describe('ScriptBlock', () => {
  it('renders script tag string when child has value', () => {
    const node: ScriptNode = {
      children: [{ value: 'alert("hi")' }],
    }

    const { container } = render(
      <ScriptBlock node={node} />,
    )

    expect(container.textContent).toBe('<script>alert("hi")</script>')
  })

  it('renders empty script tag when child value is undefined', () => {
    const node: ScriptNode = {
      children: [{}],
    }

    const { container } = render(
      <ScriptBlock node={node} />,
    )

    expect(container.textContent).toBe('<script></script>')
  })

  it('renders empty script tag when children array is empty', () => {
    const node: ScriptNode = {
      children: [],
    }

    const { container } = render(
      <ScriptBlock node={node} />,
    )

    expect(container.textContent).toBe('<script></script>')
  })

  it('preserves multiline script content', () => {
    const multi = `console.log("line1");
console.log("line2");`

    const node: ScriptNode = {
      children: [{ value: multi }],
    }

    const { container } = render(
      <ScriptBlock node={node} />,
    )

    expect(container.textContent).toBe(`<script>${multi}</script>`)
  })

  it('has displayName set correctly', () => {
    expect(ScriptBlock.displayName).toBe('ScriptBlock')
  })
})
