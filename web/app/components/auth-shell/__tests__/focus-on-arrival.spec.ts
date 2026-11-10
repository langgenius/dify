import { focusOnArrival } from '../focus-on-arrival'

const setCoarsePointer = (coarse: boolean) => {
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query) =>
      ({ matches: coarse && query === '(pointer: coarse)', media: query }) as MediaQueryList,
  )
}

const mountInput = () => {
  const input = document.createElement('input')
  document.body.append(input)
  return input
}

afterEach(() => {
  vi.restoreAllMocks()
  document.body.replaceChildren()
})

it('focuses the field when nothing else has focus', () => {
  setCoarsePointer(false)
  const input = mountInput()

  focusOnArrival(input)

  expect(document.activeElement).toBe(input)
})

it('leaves focus where the user already moved it', () => {
  setCoarsePointer(false)
  const button = document.createElement('button')
  document.body.append(button)
  button.focus()
  const input = mountInput()

  focusOnArrival(input)

  expect(document.activeElement).toBe(button)
})

it('does not open the on-screen keyboard on touch devices', () => {
  setCoarsePointer(true)
  const input = mountInput()

  focusOnArrival(input)

  expect(document.activeElement).not.toBe(input)
})
