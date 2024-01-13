import { createClient } from 'redis'
import express from 'express'

import cors from 'cors'

import { api, redisConfig, servers } from './config.mjs'
import { listenToEvents } from './listenToEvents.mjs'
import { getEventType } from './getEventType.mjs'

import { Telegraf } from 'telegraf'
// import { message } from 'telegraf/filters'

const bot = new Telegraf(api.BOT_TOKEN)
bot.start((ctx) => ctx.reply('Welcome'))
// bot.help((ctx) => ctx.reply('Send me a sticker'))
// bot.on(message('sticker'), (ctx) => ctx.reply('👍'))
// bot.hears('hi', (ctx) => ctx.reply('Hey there'))
bot.launch()

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'))
process.once('SIGTERM', () => bot.stop('SIGTERM'))

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
  let message = ''
  let preMessage = ''
  const redis = await connectToRedis()

  listenToEvents(servers, (server, channel, user, eventName, eventType, event) => {
    const type = getEventType(eventName, eventType)

    console
    if (!type) {
      return
    }

    // console.log(server.type, server.address, channel, user, eventName, eventType, JSON.stringify(event, null, 2))
    // console.log(server.address, eventName, eventType)

    const { from } = event

    try {
      if (eventName === 'onMessagePacket') {
        redis.hGetAll(`device:${from}`).then(answer => {
          message = event.data + event.from
          if (message === preMessage) {
            return
          }
          preMessage = message
          console.log(new Date().toLocaleTimeString(), new Date().toLocaleDateString(), JSON.parse(answer.user).data.longName, '(', event.from, '):', event.data)
          if (server.telegram) bot.telegram.sendMessage(api.CHANNEL_ID, 'MESH ✉️ ' + JSON.parse(answer.user).data.longName + ': ' + event.data)
        })
      }
    } catch (err) {
      console.log(err)
      return
    }

    return

    redis.hSet(`device:${from}`,
      {
        server: server.name,
        // timestamp: event.rxTime.toISOString(), // время из сообщения
        timestamp: new Date().toISOString(), // время сервера
        [type]: JSON.stringify(event)
      }
    ).then(() => { // тут можно включить самоудаление сообщений из базы
      // whoami
      // redis.expire(`device:${from}`, redisConfig.ttl)
    })
  })

  startServer(redis)
}
connectToMeshtastic()