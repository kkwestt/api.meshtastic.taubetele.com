import { createClient } from 'redis'
import express from 'express'
import compression from 'compression'

import cors from 'cors'
import { isEqual, reduce } from 'lodash-es'

import { redisConfig, servers } from './config.mjs'
import { listenToEvents } from './listenToEvents.mjs'
import { getEventType } from './getEventType.mjs'
// import { Telegraf } from 'telegraf'

import { sendTelegramMessage } from './telegram.mjs'

// import TimeAgo from 'javascript-time-ago'
// import en from 'javascript-time-ago/locale/en'
// TimeAgo.addDefaultLocale(en) // Create formatter (English).
// const timeAgo = new TimeAgo('en-US')

const MAX_METADATA_ITEMS_COUNT = 200

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
    const cachedKeysNew = await redis.keys('device:*')

    cachedValues = await Promise.all(
      cachedKeysNew.map((key) => redis.hGetAll(key))
    )

    cachedKeys = cachedKeysNew
  }

  setInterval(queryData, 5000)

  // app.get('/simple', async (req, res) => {
  //   let start = performance.now()

  //   if (!cachedValues) {
  //     await queryData()
  //   }

  //   console.log('query', performance.now() - start)
  //   start = performance.now()

  //   console.log('values', performance.now() - start)
  //   start = performance.now()

  //   const result = cachedKeys.reduce((result, key, index) => {
  //     const { server, timestamp, ...rest } = cachedValues[index]

  //     const deviceResult = {
  //       server,
  //       timestamp: new Date(timestamp).getTime()
  //     }

  //     if (rest.message) {
  //       deviceResult.message = JSON.parse(rest.message).data
  //     }

  //     Object.entries(rest).forEach(([key, value]) => {
  //       const valuesKeys = valuesPaths[key]
  //       if (valuesKeys) {
  //         const data = JSON.parse(value)
  //         deviceResult[key] = {}

  //         Object.keys(valuesKeys).forEach((valueKey) => {
  //           let value = get(data, valuesKeys[valueKey])
  //           if (typeof value === 'number') {
  //             value = Number(value.toFixed(3))
  //           }

  //           deviceResult[key][valueKey] = value
  //         })
  //       }
  //     })

  //     const from = key.substr(7) // device:3663493320, drop "device:"
  //     result[from] = deviceResult

  //     return result
  //   }, {})

  //   console.log('responce', performance.now() - start)
  //   res.json(result)
  // })

  // app.get('/stream', (req, res) => {
  //   res.setHeader('Cache-Control', 'no-cache')
  //   res.setHeader('Content-Type', 'text/event-stream')
  //   res.setHeader('Access-Control-Allow-Origin', '*')
  //   res.setHeader('Connection', 'keep-alive')
  //   res.flushHeaders() // flush the headers to establish SSE with client

  //   let counter = 0
  //   const interValID = setInterval(() => {
  //     counter++
  //     if (counter >= 10) {
  //       clearInterval(interValID)
  //       res.end() // terminates SSE session
  //       return
  //     }
  //     res.write(`data: ${JSON.stringify({ num: counter })}\n\n`) // res.write() instead of res.send()
  //   }, 1000)

  //   // If client closes connection, stop sending events
  //   res.on('close', () => {
  //     console.log('client dropped me')
  //     clearInterval(interValID)
  //     res.end()
  //   })
  // })

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
    const result = cachedKeys
      .reduce((result, key, index) => {
        if (!cachedValues[index]) {
          console.error('/api: empty key value', key)
          return result
        }
        const { server, timestamp, ...rest } = cachedValues[index]
        const isExpired = Date.now() - new Date(timestamp).getTime() >= 60 * 60 * 24 * 1000
        if (isExpired) {
          return result
        }
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
          .then((length) => {
            if (length <= MAX_METADATA_ITEMS_COUNT) {
              return
            }
            const diff = length - MAX_METADATA_ITEMS_COUNT
            // console.log('!!! len', length, diff, key)
            return redis.lTrim(key, diff, length)
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

          console.log('message', event)

          redis.hGetAll(key).then((answer) => {
            message = event.data + event.from
            if (message === preMessage) {
              return
            }
            preMessage = message

            /*
              event
                from
                device:from
                  device:from:user:data:id === gatewayId
                  device:from:user:data:longName
                gatewayId
                user:gatewayId
                  user:gatewayId:from
                  user:gatewayId:longName
            */

            const sendMessage = (recivedByLongName, recivedByGatewayId) => {
              let userData
              try {
                userData = JSON.parse(answer?.user)?.data
              } catch {}

              const fromLongName = userData?.longName || ''
              const fromId = userData?.id || from || ''

              if (server.telegram) {
                sendTelegramMessage(`\u{1F4E1} RX: ${recivedByLongName || ''} (${recivedByGatewayId || ''}) Hop: ${event.hopLimit} RSSI/SNR: ${event.rxRssi}/${event.rxSnr}  \n\u{1F4DF} From: ${fromLongName} (${fromId}) \n✉️ Msg: ${event.data}`)
              }
            }

            redis.hGetAll(`user:${event.gatewayId}`).then((userData) => {
              sendMessage(userData?.longName, event.gatewayId)
            }).catch(() => {
              sendMessage('')
            })
          })
        }
      } catch (err) {}

      redis.hSet(key, {
        server: server.name,
        timestamp: new Date(serverTime).toISOString(),
        [type]: JSON.stringify({
          serverTime, // тут поменять rxTime  на время сервера
          ...event
        })
      })

      if (type === 'user') {
        const { shortName, longName } = event?.data || {}

        redis.hSet(`user:${event.data.id}`, {
          from,
          shortName,
          longName
        })
      }

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
        if (latitudeI === 0 || longitudeI === 0) return
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

        // для тестов/отладки
        // redis.rPush(`log:${telemetryKey}`,
        //   JSON.stringify({
        //     serverTime,
        //     event
        //   })
        // )

        upsertItem(telemetryKey, serverTime, event)
      }
    }
  )

  startServer(redis)
}

connectToMeshtastic()
