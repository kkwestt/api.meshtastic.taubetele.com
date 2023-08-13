// const fs = require('fs')
const mqtt = require('mqtt')
const servers = require('./servers.js')
const protobuf = require('protobufjs')

const devices = {}

const callbacks = (server) => ({
  connect: (client) => () => {
    // console.debug(`Trying to connect to ${server.name}`)
    client.subscribe('#', (err) => {
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
      // console.debug('---')
      // console.debug(parsed)
    } catch (any) {
      // console.debug('---')

      // protobuf.load('./protobufs/meshtastic/mesh.proto', function (err, root) {
      //   if (err) {
      //     console.error('Error loading .proto file:', err)
      //     return
      //   }
      //   try {
      //     const ExampleMessage = root.lookupType('meshtastic.Position')
      //     const decodedMessage = ExampleMessage.decode(buffer)
      //     console.log(decodedMessage)
      //   } catch (any) { }
      // })

      protobuf.load('./protobufs/meshtastic/mqtt.proto', function (err, root) {
        if (err) {
          console.error('Error loading .proto file:', err)
          return
        }
        try {
          const ExampleMessage = root.lookupType('meshtastic.ServiceEnvelope')
          const decodedMessage = ExampleMessage.decode(buffer)
          console.log(decodedMessage)
        } catch (any) { }
      })

      // console.debug('Cant parse message, skipping')
      // console.debug(buffer.toString())
      try { // throw new Error()
      } catch (any) {
        console.log(any.message ? any.message : any)
      }
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
    } else if (parsed?.payload?.temperature) {
      devices[parsed.from].telemetry2 = parsed
    } else {
      devices[parsed.from][parsed.type] = parsed
    }
    devices[parsed.from].timestamp = parsed.timestamp

    if (!devices[parsed.from].mqtt && parsed?.payload?.id == parsed.sender) {
      // console.debug(`Sender ${parsed.sender}`)
      devices[parsed.from].mqtt = 'online'
    }

    // {"channel":0,"from":-1812372104,"id":383448021,"payload":{"text":"\u0000"},"sender":"!93f96578","timestamp":1688759976,"to":-1,"type":"text"}

    if (parsed.type == 'text') {
      console.debug(`TEXT: ${parsed.from}: ${parsed.payload.text}`)
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
