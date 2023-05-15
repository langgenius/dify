const registerAPI = function (app) {
  app.get('/demo', async (req, res) => {
    res.send({
      des: 'get res'
    })
  })

  app.post('/demo', async (req, res) => {
    res.send({
      des: 'post res'
    })
  })
}

module.exports = registerAPI