import { getAdjacentFocusTargets } from './get-adjacent-focus-targets'

it('orders sibling targets after the source first, then before it from nearest to farthest', () => {
  const list = document.createElement('div')
  list.innerHTML =
    '<section><button>A</button></section><section><button>B</button></section><section><button>C</button></section><section><button>D</button></section><section><button>E</button></section>'
  const source = list.children[2]!
  const targets = getAdjacentFocusTargets(source, (item) => item.querySelector('button'))

  expectTypeOf(targets).toEqualTypeOf<HTMLButtonElement[]>()
  expect(targets.map((target) => target.textContent)).toEqual(['D', 'E', 'B', 'A'])
})

it('lets the owner choose targets and skip siblings without one, without leaving the parent', () => {
  const container = document.createElement('div')
  container.innerHTML =
    '<a href="/outside">Outside</a><table><tbody><tr><td><a href="/a">A</a></td></tr><tr><td>Source</td></tr><tr><td><button>Action</button></td></tr><tr><td><a href="/b">B</a></td></tr></tbody></table>'
  const rows = container.querySelectorAll('tr')
  const targets = getAdjacentFocusTargets(rows[1], (row) =>
    row.querySelector<HTMLAnchorElement>('a[href]'),
  )

  expectTypeOf(targets).toEqualTypeOf<HTMLAnchorElement[]>()
  expect(targets.map((target) => target.textContent)).toEqual(['B', 'A'])
})

it('returns no candidates for a missing source or one without siblings', () => {
  const getTarget = (element: Element) => element.querySelector('button')
  expect(getAdjacentFocusTargets(null, getTarget)).toEqual([])
  expect(getAdjacentFocusTargets(undefined, getTarget)).toEqual([])
  expect(getAdjacentFocusTargets(document.createElement('div'), getTarget)).toEqual([])
  const parent = document.createElement('div')
  parent.innerHTML = '<section><button>Only item</button></section>'
  expect(getAdjacentFocusTargets(parent.firstElementChild, getTarget)).toEqual([])
})
