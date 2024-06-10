import { createClient } from 'redis'
import express from 'express'
import compression from 'compression'

import cors from 'cors'
import { isEqual, get, reduce } from 'lodash-es'

import { api, redisConfig, servers, valuesPaths } from './config.mjs'
import { listenToEvents } from './listenToEvents.mjs'
import { getEventType } from './getEventType.mjs'
import { Telegraf } from 'telegraf'

const MAX_METADATA_ITEMS_COUNT = 999

const bot = new Telegraf(api.BOT_TOKEN)

bot.catch((err, ctx) => {
  console.log(`Bot Catched ERROR: ${err}`)
})

bot.command('example', (ctx) => ctx.reply(''))
bot.start((ctx) => ctx.reply('Welcome '))
bot.launch()

process.once('SIGINT', () => bot.stop('SIGINT'))
process.once('SIGTERM', () => bot.stop('SIGTERM'))

const connectToRedis = async () => {
  const client = await createClient(redisConfig)
    .on('error', (err) => console.log('Redis Client Error', err))
    .connect()
  return client
}

function startServer (redis) {
  const app = express()

  app.use(compression())

  app.use(
    cors({
      origin: (origin, callback) => {
        callback(null, origin || '*')
      },
      // credentials: true,
      allowedHeaders: ['Content-Type']
    })
  )

  app.use(cors())

  let cachedKeys = null
  let cachedValues = null

  const queryMetadata = async (from, type) => {
    const data = (
      await redis.lRange(`${type}:${from}`, 0, MAX_METADATA_ITEMS_COUNT)
    ).map((item) => JSON.parse(item))
    return data
  }

  const queryData = async () => {
    cachedKeys = await redis.keys('device:*')
    cachedValues = await Promise.all(
      cachedKeys.map((key) => redis.hGetAll(key))
    )
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

          Object.keys(valuesKeys).forEach((valueKey) => {
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

  app.get('/stream', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders() // flush the headers to establish SSE with client

    let counter = 0
    const interValID = setInterval(() => {
      counter++
      if (counter >= 10) {
        clearInterval(interValID)
        res.end() // terminates SSE session
        return
      }
      res.write(`data: ${JSON.stringify({ num: counter })}\n\n`) // res.write() instead of res.send()
    }, 1000)

    // If client closes connection, stop sending events
    res.on('close', () => {
      console.log('client dropped me')
      clearInterval(interValID)
      res.end()
    })
  })

  app.get('/gps:from', async (req, res) => {
    const from = req.params.from.substring(1)
    const data = await queryMetadata(from, 'gps')
    res.json({ from, data })
  })

  app.get('/deviceMetrics:from', async (req, res) => {
    const from = req.params.from.substring(1)
    const data = await queryMetadata(from, 'deviceMetrics')
    res.json({ from, data })
  })

  app.get('/environmentMetrics:from', async (req, res) => {
    const from = req.params.from.substring(1)
    const data = await queryMetadata(from, 'environmentMetrics')
    res.json({ from, data })
  })

  app.get('/api', async (req, res) => {
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

  app.listen(80)
}

async function connectToMeshtastic () {
  let message = ''
  let preMessage = ''
  const redis = await connectToRedis()

  function upsertItem (key, serverTime, newItem) {
    redis.lRange(key, -1, -1).then((res) => {
      const [lastItemStr] = res
      const isNewItem = !lastItemStr
      let isUpdated = false

      if (!isNewItem) {
        const { time, ...lastPosItem } = JSON.parse(lastItemStr)

        const a = newItem
        const b = lastPosItem

        const diff = reduce(
          a,
          (result, aValue, key) => {
            const bValue = b[key]
            if (typeof value === 'number' && typeof bValue === 'number') {
              return aValue.toFixed(5) === bValue.toFixed(5)
                ? result
                : result.concat(key)
            }
            return isEqual(aValue, b[key]) ? result : result.concat(key)
          },
          []
        )
        isUpdated = diff.length > 0 //! isEqual(lastPosItem, newItem)

        // if (isUpdated) {
        //   console.log('updated', key, newItem, lastPosItem, diff)
        // }
      }

      if (isNewItem || isUpdated) {
        redis
          .rPush(
            key,
            JSON.stringify({
              time: serverTime,
              ...newItem
            })
          )
          .then((res) => {
            return redis.lTrim(key, 0, MAX_METADATA_ITEMS_COUNT)
          })
      } /* else {
        redis.lSet(
          key,
          -1,
          JSON.stringify({
            time: serverTime,
            ...newItem
          })
        )
      } */
    })
  }

  listenToEvents(
    servers,
    (server, channel, user, eventName, eventType, event) => {
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

          redis.hGetAll(key).then((answer) => {
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
                  bot.telegram.sendMessage(
                    api.CHANNEL_ID,
                    '✉️' + longName + ':  ' + event.data
                  )
                  // console.log('✉️' + longName + ':  ' + event.data)
                }
              } catch (err) {}
            }
          })
        }
      } catch (err) {
        // console.log('ERROR onMessagePacket', err)
      }

      redis.hSet(key, {
        server: server.name,
        timestamp: new Date(serverTime).toISOString(),
        [type]: JSON.stringify({
          serverTime, // тут поменять rxTime  на время сервера
          ...event
        })
      })
      // .then(() => {
      // redis.expire(key, redisConfig.ttl)  // тут можно включить самоудаление сообщений из базы
      // })

      function round (num, decimalPlaces = 0) {
        num = Math.round(num + 'e' + decimalPlaces)
        return Number(num + 'e' + -decimalPlaces)
      }

      if (type === 'position') {
        const gpsKey = `gps:${from}`
        const { latitudeI, longitudeI, altitude, seqNumber } = event?.data || { }
        const newPosItem = { latitudeI, longitudeI, altitude, seqNumber }
        upsertItem(gpsKey, serverTime, newPosItem)
      } else if (type === 'deviceMetrics') {
        const telemetryKey = `deviceMetrics:${from}`
        let { batteryLevel, voltage, channelUtilization, airUtilTx } = event?.data?.variant?.value || { }
        batteryLevel > 100 ? batteryLevel = 100 : round(batteryLevel, 0)
        voltage = round(voltage, 2)
        channelUtilization = round(channelUtilization, 1)
        airUtilTx = round(airUtilTx, 1)
        const newPosItem = { batteryLevel, voltage, channelUtilization, airUtilTx }
        upsertItem(telemetryKey, serverTime, newPosItem)
      } else if (type === 'environmentMetrics') {
        const telemetryKey = `environmentMetrics:${from}`
        let { temperature, relativeHumidity, barometricPressure, gasResistance, voltage, current } = event?.data?.variant?.value || { }
        temperature = round(temperature, 1)
        relativeHumidity = round(relativeHumidity, 0)
        barometricPressure = round(barometricPressure, 0)
        gasResistance = round(gasResistance, 0)
        voltage = round(voltage, 2)
        current = round(current, 2)
        const newPosItem = { temperature, relativeHumidity, barometricPressure, gasResistance, voltage, current }
        upsertItem(telemetryKey, serverTime, newPosItem)
      } else if (type === 'message') {
        const telemetryKey = `message:${from}`
        upsertItem(telemetryKey, serverTime, event)
      } else if (type === 'deviceMetadata') {
        const telemetryKey = `message:${from}`
        upsertItem(telemetryKey, serverTime, event)
      }
    }
  )

  startServer(redis)
}

connectToMeshtastic()
