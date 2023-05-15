
const registerAPI = function (app) {
  app.post('/login', async (req, res) => {
    res.send({
      result: 'success'
    })
  })

  // get user info
  app.get('/account/profile', async (req, res) => {
    res.send({
      id: '11122222',
      name: 'Joel',
      email: 'iamjoel007@gmail.com'
    })
  })

  // logout
  app.get('/logout', async (req, res) => {
    res.send({
      result: 'success'
    })
  })

  // Langgenius version
  app.get('/version', async (req, res) => {
    res.send({
      current_version: 'v1.0.0',
      latest_version: 'v1.0.0',
      upgradeable: true,
      compatible_upgrade: true
    })
  })

}

module.exports = registerAPI

