import { createClient } from 'redis'
import express from 'express'

import cors from 'cors'

import { redisConfig, servers } from './config.mjs'
import { listenToEvents } from './listenToEvents.mjs'
import { getEventType } from './getEventType.mjs'

const connectToRedis = async () => {
  const client = await createClient(redisConfig)
    .on('error', err => console.log('Redis Client Error', err))
    .connect()

  return client
}

function startServer (redis) {
  const app = express()

  app.use(cors({
    origin: (origin, callback) => {
      callback(null, origin || '*')
    },
    // credentials: true,
    allowedHeaders: ['Content-Type']
  }))

  app.use(cors())

  app.get('/', async (req, res) => {
    const keys = await redis.keys('device:*')

    const values = await Promise.all(keys.map(key => redis.hGetAll(key)))

    const result = keys.reduce((result, key, index) => {
      const { server, timestamp, ...rest } = values[index]

      const data = {
        server,
        timestamp
      }

      Object.entries(rest).forEach(([key, value]) => {
        data[key] = JSON.parse(value)
      })

      result[key.substr(7)] = data

      return result
    }, {})

    res.json(result)
  })

  app.listen(80) // What about .env me or config.js me, hah?
}

// имхо, пакет @buf/meshtastic_protobufs.bufbuild_es можно генерировать вручную. он заблочен для РФ
// todo проставить правильные зависимости в package.json / взять из codesandbox
// закодированные сообщения не попадают в callback

async function connectToMeshtastic () {
  const redis = await connectToRedis()

  listenToEvents(servers, (server, channel, user, eventName, eventType, event) => {
    const type = getEventType(eventName, eventType)

    if (!type) {
      return
    }

    console.log(new Date().toLocaleTimeString(), new Date().toLocaleDateString())
    // console.log(server.type, server.address, channel, user, eventName, eventType, JSON.stringify(event, null, 2))
    // console.log(server.address, eventName, eventType)

    // console.log('from:', event.from, ' - ', event.data)

    // console.log( await redis.hGetAll('device:' + event.from))

    const { from } = event

    redis.hGetAll(`device:${from}`).then(answer => {
      console.log(answer.user.data.longName)
      console.log(' ')
    })

    // server: 'meshtastic.taubetele.com'

    if (eventName === 'onMessagePacket') {
      console.log('timestamp:', new Date().toLocaleTimeString(), new Date().toLocaleDateString())
      console.log('Message from:', event.from, event.data)
    }
    return

    // const { from } = event

    redis.hSet(`device:${from}`,
      {
        server: server.name,
        // timestamp: event.rxTime.toISOString(),
        timestamp: new Date().toISOString(),
        [type]: JSON.stringify(event)
      }
    )
  })

  startServer(redis)
}

connectToMeshtastic()

// mqtt mqtt://admin:meshtastic@meshtastic.taubetele.com LongFast !25a77688 onMessagePacket String {
//   "rxSnr": 0,
//   "hopLimit": 6,
//   "wantAck": false,
//   "rxRssi": 0,
//   "id": 176645372,
//   "rxTime": "2024-01-13T12:35:26.000Z",
//   "type": "broadcast",
//   "from": 500021556, mashino gw8
//   "to": 4294967295,
//   "channel": 0,
//   "data": "123123"
// }
