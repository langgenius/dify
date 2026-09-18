import { getInitialNamespacesForPath, shellNamespaces } from '../initial-namespaces'
import { namespaces } from '../resources'

describe('getInitialNamespacesForPath', () => {
  it('loads only shell namespaces on a lightweight apps route', () => {
    const initial = getInitialNamespacesForPath('/apps')

    expect(initial).toEqual(expect.arrayContaining([...shellNamespaces]))
    expect(initial).toContain('explore')
    expect(initial).not.toContain('workflow')
    expect(initial).not.toContain('dataset')
    expect(initial.length).toBeLessThan(namespaces.length)
  })

  it('includes dataset namespaces for datasets routes', () => {
    const initial = getInitialNamespacesForPath('/datasets/new/space-1/documents')

    expect(initial).toContain('dataset')
    expect(initial).toContain('datasetDocuments')
    expect(initial).not.toContain('workflow')
    expect(initial.length).toBeLessThan(namespaces.length)
  })

  it('includes studio namespaces for app detail routes', () => {
    const initial = getInitialNamespacesForPath('/app/app-1/workflow')

    expect(initial).toContain('workflow')
    expect(initial).toContain('appDebug')
    expect(initial).toContain('agentV2')
    expect(initial).not.toContain('dataset')
  })

  it('includes explore on sign-in routes for post-auth landing pages', () => {
    const initial = getInitialNamespacesForPath('/signin')

    expect(initial).toContain('explore')
  })

  it('includes share namespaces for embedded web app routes', () => {
    const initial = getInitialNamespacesForPath('/chat/token-1')

    expect(initial).toContain('share')
    expect(initial).toContain('workflow')
  })

  it('includes app overview namespaces for agent routes', () => {
    const initial = getInitialNamespacesForPath('/agents/agent-1/access')

    expect(initial).toContain('agentV2')
    expect(initial).toContain('appOverview')
  })

  it('includes billing namespaces for account settings routes', () => {
    const initial = getInitialNamespacesForPath('/account/profile')

    expect(initial).toContain('billing')
    expect(initial).toContain('permission')
  })
})
