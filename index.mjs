import { createClient } from 'redis'
import express from 'express'
import compression from 'compression'

import cors from 'cors'
import { isEqual, get } from 'lodash-es'

import { api, redisConfig, servers, valuesPaths } from './config.mjs'
import { listenToEvents } from './listenToEvents.mjs'
import { getEventType } from './getEventType.mjs'
import { Telegraf } from 'telegraf'

const bot = new Telegraf(api.BOT_TOKEN)
if (api.enable) {
  bot.catch((err, ctx) => {
    console.log(`Bot Catched ERROR: ${err}`)
  })

  bot.command('example', (ctx) => ctx.reply(''))
  bot.start((ctx) => ctx.reply('Welcome '))
  bot.launch()

  process.once('SIGINT', () => bot.stop('SIGINT'))
  process.once('SIGTERM', () => bot.stop('SIGTERM'))
}

const connectToRedis = async () => {
  const client = await createClient(redisConfig)
    .on('error', err => console.log('Redis Client Error', err))
    .connect()
  return client
}

function startServer (redis) {
  const app = express()

  app.use(compression())

  app.use(cors({
    origin: (origin, callback) => {
      callback(null, origin || '*')
    },
    // credentials: true,
    allowedHeaders: ['Content-Type']
  }))

  app.use(cors())

  let cachedKeys = null
  let cachedValues = null

  const queryData = async () => {
    cachedKeys = await redis.keys('device:*')
    cachedValues = await Promise.all(cachedKeys.map(key => redis.hGetAll(key)))
  }

  setInterval(queryData, 10000)

  app.get('/simple', async (req, res) => {
    let start = performance.now()

    if (!cachedValues) {
      await queryData()
    }

    console.log('query', performance.now() - start)
    start = performance.now()

    console.log('values', performance.now() - start)
    start = performance.now()

    const result = cachedKeys.reduce((result, key, index) => {
      const { server, timestamp, ...rest } = cachedValues[index]

      const deviceResult = {
        server,
        timestamp: new Date(timestamp).getTime()
      }

      if (rest.message) {
        deviceResult.message = JSON.parse(rest.message).data
      }

      Object.entries(rest).forEach(([key, value]) => {
        const valuesKeys = valuesPaths[key]
        if (valuesKeys) {
          const data = JSON.parse(value)
          deviceResult[key] = {}

          Object.keys(valuesKeys).forEach(valueKey => {
            let value = get(data, valuesKeys[valueKey])
            if (typeof value === 'number') {
              value = Number(value.toFixed(3))
            }

            deviceResult[key][valueKey] = value
          })
        }
      })

      const from = key.substr(7) // device:3663493320, drop "device:"
      result[from] = deviceResult

      return result
    }, {})

    console.log('responce', performance.now() - start)
    res.json(result)
  })

  app.get('/', async (req, res) => {
    if (!cachedValues) {
      await queryData()
    }

    const result = cachedKeys.reduce((result, key, index) => {
      const { server, timestamp, ...rest } = cachedValues[index]

      const data = {
        server,
        timestamp
      }

      Object.entries(rest).forEach(([key, value]) => {
        data[key] = JSON.parse(value)
      })

      const from = key.substr(7) // device:3663493320, drop "device:"
      result[from] = data

      return result
    }, {})

    res.json(result)
  })

  app.get('/gps:from', async (req, res) => {
    const from = req.params.from.substring(1)
    const data = (await redis.lRange(`gps:${from}`, 0, 199)).map(item => JSON.parse(item))
    // console.log('gps', { from })
    res.json({ from, data })
  })

  app.get('/deviceMetrics:from', async (req, res) => {
    const from = req.params.from.substring(1)
    const data = (await redis.lRange(`deviceMetrics:${from}`, 0, 199)).map(item => JSON.parse(item))
    // console.log('gps', { from })
    res.json({ from, data })
  })

  app.get('/environmentMetrics:from', async (req, res) => {
    const from = req.params.from.substring(1)
    const data = (await redis.lRange(`environmentMetrics:${from}`, 0, 199)).map(item => JSON.parse(item))
    // console.log('gps', { from })
    res.json({ from, data })
  })

  app.listen(80)
}

async function connectToMeshtastic () {
  let message = ''
  let preMessage = ''
  const redis = await connectToRedis()

  function upsertItem (key, serverTime, newItem) {
    redis
      .lRange(key, -1, -1)
      .then(([lastItemStr]) => {
        const isNewItem = !lastItemStr

        if (lastItemStr) {
          const { time, ...lastPosItem } = JSON.parse(lastItemStr)
          lastItemStr = !isEqual(lastPosItem, newItem)
        }

        if (isNewItem) {
          redis
            .rPush(key, JSON.stringify({
              time: serverTime,
              ...newItem
            }))
            .then((res) => {
              return redis.lTrim(key, 0, 199) // no more 200 row
            })
        } else {
          redis
            .lSet(key, -1, JSON.stringify({
              time: serverTime,
              ...newItem
            }))
        }
      })
  }

  listenToEvents(servers, (server, channel, user, eventName, eventType, event) => {
    const type = getEventType(eventName, eventType, event)
    if (!type) return

    // console.log('!!!###', type, eventName, eventType, event)

    const { from } = event

    const key = `device:${from}`
    const serverTime = Date.now()

    try {
      if (type === 'message' || eventName === 'onMessagePacket') {
        if (event.type === 'direct') {
          // console.log('MESSAGE DIRECT: ', new Date().toLocaleTimeString(), new Date().toLocaleDateString(), '(', event.from, '):', event.data)
          return
        }

        redis.hGetAll(key).then(answer => {
          message = event.data + event.from
          if (message === preMessage) {
            return
          }
          preMessage = message

          let longName

          if (answer?.user) {
            try {
              const userData = JSON.parse(answer.user)
              if (userData && userData.data && userData.data.longName) {
                longName = userData.data.longName
                // console.log('MESSAGE PUBLICK: ', new Date().toLocaleTimeString(), new Date().toLocaleDateString(), longName, '(', event.from, '):', event.data)
              }
              if (server.telegram && api.enable) {
                bot.telegram.sendMessage(api.CHANNEL_ID, '✉️' + longName + ':  ' + event.data)
                // console.log('✉️' + longName + ':  ' + event.data)
              }
            } catch (err) {
            }
          }
        })
      }
    } catch (err) {
      // console.log('ERROR onMessagePacket', err)
    }

    redis
      .hSet(key, {
        server: server.name,
        timestamp: new Date(serverTime).toISOString(), // время сервера
        [type]: JSON.stringify(event)
      })
      // .then(() => {
      // redis.expire(key, redisConfig.ttl)  // тут можно включить самоудаление сообщений из базы
      // })

    if (type === 'position') {
      const gpsKey = `gps:${from}`

      const {
        latitudeI,
        longitudeI,
        altitude,
        seqNumber
      } = event?.data || {}

      const newPosItem = { latitudeI, longitudeI, altitude, seqNumber }

      upsertItem(gpsKey, serverTime, newPosItem)
    } else if (type === 'deviceMetrics') {
      const telemetryKey = `deviceMetrics:${from}`
      upsertItem(telemetryKey, serverTime, event.data.variant.value)
    } else if (type === 'environmentMetrics') {
      const telemetryKey = `environmentMetrics:${from}`
      upsertItem(telemetryKey, serverTime, event.data.variant.value)
    }
  })

  startServer(redis)
}

connectToMeshtastic()
