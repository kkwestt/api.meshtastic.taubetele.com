// const fs = require('fs')
const mqtt = require('mqtt')
const servers = require('./servers.js')
const protobuf = require('protobufjs')
const fs = require('fs')
const path = require('path')

const devices = {}

const root = new protobuf.Root()

const protoDirectory = './protobufs/meshtastic'

fs.readdirSync(protoDirectory).forEach(file => {
  if (file.endsWith('.proto')) {
    console.log('Reading', file)
    const filePath = path.join(protoDirectory, file)
    const content = fs.readFileSync(filePath, 'utf-8')
    protobuf.parse(content, root)
  }
})

const protobufTryParse = (buffer) => {
  let message

  for (const type of Object.keys(root.nested.meshtastic)) {
    let MessageType
    try {
      MessageType = root.lookupType(`meshtastic.${type}`)
    } catch {
      continue
    }

    try {
      message = MessageType.decode(buffer)
      // console.log('Decoded using type:', type)
      return {
        message,
        type
      }
    } catch (error) {
    // Decoding failed, try the next type
    }
  }
}

const callbacks = (server) => ({
  connect: (client) => () => {
    console.debug(`Trying to connect to ${server.name}`)
    client.subscribe('#', (err) => {
      if (err) {
        throw err
      }
      console.debug(`Connected to ${server.name}`)
    })
  },
  message: (client) => (topic, buffer) => {
    if (buffer[0] === 0x7b) {
      // console.log('This buffer is JSON')
      // TODO: buffer -> struct -> action
    } else {
      // TODO: buffer -> struct -> action
      // console.log('This buffer is POSSIBLY protobuf')

      const parsed = protobufTryParse(buffer)

      if (!parsed) {
        console.log('Schema is nor resolved')
        return false
      }

      const { message, type } = parsed
      console.log(message, type)
    }

    // let parsed
    // try {
    //   parsed = JSON.parse(buffer.toString())
    // } catch (any) {
    //   try {
    //     const message = protobufRoots.mqtt.lookupType('meshtastic.ServiceEnvelope')
    //     const decodedMessage = message.decode(buffer)

    //     // console.log('Message', decodedMessage)

    //     if (decodedMessage?.packet?.decoded?.payload) {
    //       const payload = decodedMessage.packet.decoded.payload
    //       console.log('Payload', payload.toString())
    //     }

    //     if (decodedMessage?.packet?.encrypted) {
    //       console.log('Payload is encrypted, TBI')
    //     }
    //   } catch (any) {
    //     // console.log('Loaded proto is not resolving this message')
    //     return false
    //   }
    //   return false
    // }

    // if (!parsed.from) {
    //   return false
    // }

    // if (!parsed.type) {
    //   return false
    // }

    // if (!devices[parsed.from]) {
    //   devices[parsed.from] = { [parsed.type]: parsed, server: server.name }
    // } else if (parsed?.payload?.temperature) {
    //   devices[parsed.from].telemetry2 = parsed
    // } else {
    //   devices[parsed.from][parsed.type] = parsed
    // }
    // devices[parsed.from].timestamp = parsed.timestamp

    // if (!devices[parsed.from].mqtt && parsed?.payload?.id === parsed.sender) {
    //   devices[parsed.from].mqtt = 'online'
    // }

    // // {"channel":0,"from":-1812372104,"id":383448021,"payload":{"text":"\u0000"},"sender":"!93f96578","timestamp":1688759976,"to":-1,"type":"text"}

    // if (parsed.type === 'text') {
    //   console.debug(`TEXT: ${parsed.from}: ${parsed.payload.text}`)
    // }
  }
})

servers.forEach(server => {
  const client = mqtt.connect(server.address)
  const serverCallbacks = callbacks(server)
  Object.keys(serverCallbacks).forEach(callback => {
    client.on(callback, serverCallbacks[callback](client))
  })
})

const app = require('express')()
const cors = require('cors')

app.use(cors({
  origin: (origin, callback) => {
    callback(null, origin || '*')
  },
  allowedHeaders: ['Content-Type']
}))

app.use(cors())

app.get('/', (req, res) => {
  res.json(devices)
})

app.listen(80) // What about .env me or config.js me, hah?
