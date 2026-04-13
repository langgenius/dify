import * as ModelAuth from '../index'

vi.mock('../add-credential-in-load-balancing', () => ({ default: 'AddCredentialInLoadBalancing' }))
vi.mock('../add-custom-model', () => ({ default: 'AddCustomModel' }))
vi.mock('../authorized', () => ({ default: 'Authorized' }))
vi.mock('../config-model', () => ({ default: 'ConfigModel' }))
vi.mock('../credential-selector', () => ({ default: 'CredentialSelector' }))
vi.mock('../manage-custom-model-credentials', () => ({ default: 'ManageCustomModelCredentials' }))
vi.mock('../switch-credential-in-load-balancing', () => ({ default: 'SwitchCredentialInLoadBalancing' }))

describe('model-auth index exports', () => {
  it('should re-export the model auth entry points', () => {
    expect(ModelAuth).toMatchObject({
      AddCredentialInLoadBalancing: 'AddCredentialInLoadBalancing',
      AddCustomModel: 'AddCustomModel',
      Authorized: 'Authorized',
      ConfigModel: 'ConfigModel',
      CredentialSelector: 'CredentialSelector',
      ManageCustomModelCredentials: 'ManageCustomModelCredentials',
      SwitchCredentialInLoadBalancing: 'SwitchCredentialInLoadBalancing',
    })
  })
})
