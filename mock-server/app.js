const express = require('express')
const app = express()
const bodyParser = require('body-parser')
var cors = require('cors')

const commonAPI = require('./api/common')
const demoAPI = require('./api/demo')
const appsApi = require('./api/apps')
const debugAPI = require('./api/debug')
const datasetsAPI = require('./api/datasets')

const port = 3001

app.use(bodyParser.json()) // for parsing application/json
app.use(bodyParser.urlencoded({ extended: true })) // for parsing application/x-www-form-urlencoded

const corsOptions = {
  origin: true,
  credentials: true,
}
app.use(cors(corsOptions)) // for cross origin
app.options('*', cors(corsOptions)) // include before other routes


demoAPI(app)
commonAPI(app)
appsApi(app)
debugAPI(app)
datasetsAPI(app)


app.get('/', (req, res) => {
  res.send('rootpath')
})

app.listen(port, () => {
  console.log(`Mock run on port ${port}`)
})

const sleep = (ms) => {
  return new Promise(resolve => setTimeout(resolve, ms))
}
