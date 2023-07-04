const mqtt = require('mqtt')
const servers = require('./servers.js')

const devices = {}

const callbacks = (server) => ({
  connect: (client) => () => {
    // console.debug(`Trying to connect to ${server.name}`)
    client.subscribe('msh/2/#', (err) => {
      if (err) {
        throw err
      }
      console.debug(`Connected to ${server.name}`)
    })
  },
  message: (client) => (topic, buffer) => {
    // console.debug(`Got message at ${server.name}'s`)

    let parsed
    try {
      parsed = JSON.parse(buffer.toString())
      console.debug(parsed)
    } catch (any) {
      // console.debug('Cant parse message, skipping')
      // console.debug(buffer.toString())
      return false
    }

    if (!parsed.from) {
      // console.debug('No `from` present in message', parsed)
      return false
    }

    if (!parsed.type) {
      // console.debug('No `type` present in message', parsed)
      return false
    }

    if (!devices[parsed.from]) {
      devices[parsed.from] = { [parsed.type]: parsed, server: server.name }
    } else if (parsed.payload.temperature) {
      devices[parsed.from].telemetry2 = parsed
    } else {
      devices[parsed.from][parsed.type] = parsed
    }
    devices[parsed.from].timestamp = parsed.timestamp

    if (!devices[parsed.from].mqtt && parsed?.payload?.id == parsed.sender) {
      console.debug(`Sender ${parsed.sender}`)
      devices[parsed.from].mqtt = 'online'
    }
  }
})

servers.forEach(server => {
  // console.debug(`Trying to configure ${server.name}`)
  const client = mqtt.connect(server.address)
  const serverCallbacks = callbacks(server)
  Object.keys(serverCallbacks).forEach(callback => {
    // console.debug(`Adjusting callback '${callback}' to server '${server.name}'`)
    client.on(callback, serverCallbacks[callback](client))
  })
})

const app = require('express')()
const cors = require('cors')

app.use(cors({
  origin: (origin, callback) => {
    callback(null, origin || '*')
  },
  // credentials: true,
  allowedHeaders: ['Content-Type']
}))

app.use(cors())

app.get('/', (req, res) => {
  res.json(devices)
})

app.listen(80) // What about .env me or config.js me, hah?
