import { Telegraf } from 'telegraf'
import { botSettings } from './config.mjs'

const MESSAGE_GROUP_TIMEOUT = 7000 // 7 секунд для группировки сообщений

let bot = null

if (botSettings.ENABLE && botSettings.BOT_TOKEN) {
  bot = new Telegraf(botSettings.BOT_TOKEN)
  console.log('Telegram bot initialized')
} else {
  console.log('Telegram bot disabled or token not provided')
}

// Хранилище для группировки сообщений по ID
const messageGroups = new Map()
// Хранилище для отслеживания уже обработанных сообщений
const processedMessages = new Set()

// Очистка старых обработанных сообщений каждые 10 минут
setInterval(() => {
  processedMessages.clear()
}, 10 * 60 * 1000)

// Оптимизированная функция для получения информации о шлюзах (батчевая обработка)
const getGatewayInfoBatch = async (redis, gatewayIds) => {
  if (!gatewayIds || gatewayIds.length === 0) return {}
  
  try {
    const gatewayInfoMap = {}
    
    // Создаем массив промисов для параллельного выполнения
    const promises = []
    const gatewayIdsList = []
    
    for (const gatewayId of gatewayIds) {
      if (!gatewayId) continue
      
      let numericGatewayId = gatewayId
      if (typeof gatewayId === 'string' && gatewayId.startsWith('!')) {
        numericGatewayId = parseInt(gatewayId.substring(1), 16)
      }
      
      gatewayIdsList.push(gatewayId)
      promises.push(redis.hGetAll(`device:${numericGatewayId}`))
      promises.push(redis.hGetAll(`user:${numericGatewayId}`))
    }
    
    // Выполняем все запросы параллельно
    const results = await Promise.all(promises)
    
    // Обрабатываем результаты
    let resultIndex = 0
    for (const gatewayId of gatewayIdsList) {
      const deviceData = results[resultIndex] || {}
      const userData = results[resultIndex + 1] || {}
      resultIndex += 2
      
      let gatewayLongName = ''
      
      // Пытаемся получить имя из device данных
      if (deviceData?.user) {
        try {
          const gatewayUser = JSON.parse(deviceData.user)
          gatewayLongName = gatewayUser?.data?.longName || ''
        } catch {}
      }
      
      // Если не нашли, пытаемся из user данных
      if (!gatewayLongName && userData?.longName) {
        gatewayLongName = userData.longName
      }
      
      gatewayInfoMap[gatewayId] = {
        longName: gatewayLongName || 'Unknown',
        idHex: gatewayId
      }
    }
    
    return gatewayInfoMap
  } catch (error) {
    console.error('Error getting gateway info batch:', error.message)
    return {}
  }
}

// Функция для получения информации о шлюзе (оставляем для совместимости)
const getGatewayInfo = async (redis, gatewayId) => {
  const batch = await getGatewayInfoBatch(redis, [gatewayId])
  return batch[gatewayId] || { longName: 'Unknown', idHex: gatewayId }
}

// Оптимизированная функция для получения статистики устройства
const getDeviceStats = async (redis, deviceId) => {
  try {
    // Преобразуем hex ID в числовой формат
    let numericId = deviceId
    if (typeof deviceId === 'string' && deviceId.startsWith('!')) {
      numericId = parseInt(deviceId.substring(1), 16)
    }

    // Выполняем все запросы параллельно с помощью Promise.all
    const [
      deviceData,
      userData,
      gpsData,
      deviceMetricsData,
      envMetricsData,
      messagesData
    ] = await Promise.all([
      redis.hGetAll(`device:${numericId}`).catch(() => ({})),
      redis.hGetAll(`user:${numericId}`).catch(() => ({})),
      redis.lRange(`gps:${numericId}`, -1, -1).catch(() => []),
      redis.lRange(`deviceMetrics:${numericId}`, -1, -1).catch(() => []),
      redis.lRange(`environmentMetrics:${numericId}`, -1, -1).catch(() => []),
      redis.lRange(`messages:${numericId}`, -1, -1).catch(() => [])
    ])

    if (!deviceData && !userData) {
      return null
    }

    // Парсим данные устройства
    let user = null, position = null, deviceMetrics = null, environmentMetrics = null
    let lastSeen = null, server = deviceData.server || 'Unknown'

    try {
      if (deviceData.user) user = JSON.parse(deviceData.user)
      if (deviceData.position) position = JSON.parse(deviceData.position)
      if (deviceData.deviceMetrics) deviceMetrics = JSON.parse(deviceData.deviceMetrics)
      if (deviceData.environmentMetrics) environmentMetrics = JSON.parse(deviceData.environmentMetrics)
      if (deviceData.timestamp) lastSeen = new Date(deviceData.timestamp)
    } catch (parseError) {
      console.error('Error parsing device data:', parseError.message)
    }

    return {
      deviceId,
      numericId,
      user,
      position,
      deviceMetrics,
      environmentMetrics,
      lastSeen,
      server,
      userData,
      gpsHistory: gpsData.map(item => {
        try { return JSON.parse(item) } catch { return null }
      }).filter(Boolean),
      deviceMetricsHistory: deviceMetricsData.map(item => {
        try { return JSON.parse(item) } catch { return null }
      }).filter(Boolean),
      envMetricsHistory: envMetricsData.map(item => {
        try { return JSON.parse(item) } catch { return null }
      }).filter(Boolean),
      lastMessages: messagesData.map(item => {
        try { return JSON.parse(item) } catch { return null }
      }).filter(Boolean)
    }
  } catch (error) {
    console.error('Error getting device stats:', error.message)
    return null
  }
}

// Оптимизированная функция для форматирования статистики устройства
const formatDeviceStats = async (stats, redis) => {
  if (!stats) {
    return '❌ Устройство не найдено или нет данных'
  }

  const { deviceId, user, position, deviceMetrics, environmentMetrics, lastSeen, server, userData, gpsHistory, deviceMetricsHistory, envMetricsHistory, lastMessages } = stats

  // Собираем все gatewayId для батчевого запроса
  const gatewayIds = new Set()
  
  // Добавляем gatewayId из всех источников
  if (user?.gatewayId) gatewayIds.add(user.gatewayId)
  if (position?.gatewayId) gatewayIds.add(position.gatewayId)
  if (deviceMetrics?.gatewayId) gatewayIds.add(deviceMetrics.gatewayId)
  if (environmentMetrics?.gatewayId) gatewayIds.add(environmentMetrics.gatewayId)
  
  // Добавляем gatewayId из последних сообщений
  if (lastMessages && lastMessages.length > 0) {
    lastMessages.forEach(msg => {
      if (msg.gatewayId) gatewayIds.add(msg.gatewayId)
    })
  }
  
  // Получаем информацию о всех шлюзах одним запросом
  const gatewayInfoMap = await getGatewayInfoBatch(redis, Array.from(gatewayIds))

  let message = `📊 <b>Статистика устройства ${deviceId}</b>\n\n`

  // === NodeInfo секция ===
  const longName = user?.data?.longName || userData?.longName || 'Unknown'
  const shortName = user?.data?.shortName || userData?.shortName || 'N/A'
  const hwModel = user?.data?.hwModel || 'Unknown'
  const role = user?.data?.role || 'Unknown'

  message += ``
  message += `👤 <b>Имя:</b> ${longName} (${shortName})\n`
  message += `🔧 <b>Модель:</b> ${hwModel}\n`
  message += `⚡ <b>Роль:</b> ${role}\n`

  // Добавляем NodeInfo RX информацию
  const nodeInfoRxData = user || userData
  if (nodeInfoRxData) {
    const nodeRxRssi = user?.rxRssi || deviceMetrics?.rxRssi || position?.rxRssi || environmentMetrics?.rxRssi
    const nodeRxSnr = user?.rxSnr || deviceMetrics?.rxSnr || position?.rxSnr || environmentMetrics?.rxSnr
    const nodeHop = user?.hopLimit || user?.hop || deviceMetrics?.hopLimit || deviceMetrics?.hop || position?.hopLimit || position?.hop || environmentMetrics?.hopLimit || environmentMetrics?.hop
    const nodeGatewayId = user?.gatewayId || deviceMetrics?.gatewayId || position?.gatewayId || environmentMetrics?.gatewayId

    if (nodeRxRssi && nodeRxSnr && nodeRxRssi !== 'N/A' && nodeRxSnr !== 'N/A' && nodeGatewayId) {
      const gatewayInfo = gatewayInfoMap[nodeGatewayId]
      if (gatewayInfo) {
        message += `🛰️ <b>NodeInfo RX:</b> ${gatewayInfo.longName} (${gatewayInfo.idHex}) `
        if (nodeHop && nodeHop !== 'N/A' && nodeHop !== null) { 
          message += `Hop: ${nodeHop} `
        }
        message += `RSSI/SNR: ${nodeRxRssi}/${nodeRxSnr}\n`
      }
    }
  }

  message += '\n'

  // === Последнее сообщение ===
  if (lastMessages && lastMessages.length > 0) {
    const lastMsg = lastMessages[lastMessages.length - 1]
    if (lastMsg && lastMsg.data) {
      message += `💬 <b>Последнее сообщение</b>\n`
      message += `✉️ <b>Текст:</b> ${lastMsg.data}\n`
      
      // Добавляем Message RX информацию
      if (lastMsg.gatewayId && lastMsg.rxRssi && lastMsg.rxSnr && lastMsg.rxRssi !== 'N/A' && lastMsg.rxSnr !== 'N/A') {
        const gatewayInfo = gatewayInfoMap[lastMsg.gatewayId]
        if (gatewayInfo) {
          message += `🛰️ <b>Message RX:</b> ${gatewayInfo.longName} (${gatewayInfo.idHex}) `
          if (lastMsg.hopLimit && lastMsg.hopLimit !== 'N/A' && lastMsg.hopLimit !== null) { 
            message += `Hop: ${lastMsg.hopLimit} `
          }
          message += `RSSI/SNR: ${lastMsg.rxRssi}/${lastMsg.rxSnr}\n`
        }
      }
      
      message += '\n'
    }
  }

  // === GPS секция ===
  if (position?.data || gpsHistory.length > 0) {
    const latestPos = gpsHistory.length > 0 ? gpsHistory[gpsHistory.length - 1] : position?.data
    if (latestPos) {
      message += ``
      
      const lat = latestPos.latitudeI ? (latestPos.latitudeI / 10000000).toFixed(6) : null
      const lon = latestPos.longitudeI ? (latestPos.longitudeI / 10000000).toFixed(6) : null
      const alt = latestPos.altitude || null

      if (lat && lon) {
        message += `📍 <b>Координаты:</b> <a href="https://yandex.ru/maps/?ll=${lon},${lat}&z=15&pt=${lon},${lat},pm2rdm">${lat}, ${lon}</a>\n`
      }
      if (alt && alt !== 'N/A' && alt !== null && alt !== 0) {
        message += `🏔️ <b>Высота:</b> ${alt}м\n`
      }

      // Добавляем GPS RX информацию
      const posRxRssi = position?.rxRssi
      const posRxSnr = position?.rxSnr
      const posHop = position?.hopLimit || position?.hop
      const gatewayId = position?.gatewayId

      if (posRxRssi && posRxSnr && posRxRssi !== 'N/A' && posRxSnr !== 'N/A' && gatewayId) {
        const gatewayInfo = gatewayInfoMap[gatewayId]
        if (gatewayInfo) {
          message += `🛰️ <b>GPS RX:</b> ${gatewayInfo.longName} (${gatewayInfo.idHex}) `
          if (posHop && posHop !== 'N/A' && posHop !== null) { 
            message += `Hop: ${posHop} `
          }
          message += `RSSI/SNR: ${posRxRssi}/${posRxSnr}\n`
        }
      }

      message += '\n'
    }
  }

  // === Telemetry секция ===
  if (deviceMetrics?.data?.variant?.value || deviceMetricsHistory.length > 0) {
    const latestMetrics = deviceMetricsHistory.length > 0 ? 
      deviceMetricsHistory[deviceMetricsHistory.length - 1] : 
      deviceMetrics?.data?.variant?.value

    if (latestMetrics) {
      let hasMetrics = false
      let telemetrySection = ``

      if (latestMetrics.batteryLevel && latestMetrics.batteryLevel !== 'N/A' && latestMetrics.batteryLevel !== 0) {
        telemetrySection += `🔋 <b>Батарея:</b> ${latestMetrics.batteryLevel}%\n`
        hasMetrics = true
      }
      if (latestMetrics.voltage && latestMetrics.voltage !== 'N/A' && latestMetrics.voltage !== 0) {
        telemetrySection += `⚡ <b>Напряжение:</b> ${latestMetrics.voltage}V\n`
        hasMetrics = true
      }
      if (latestMetrics.channelUtilization && latestMetrics.channelUtilization !== 'N/A' && latestMetrics.channelUtilization !== 0) {
        telemetrySection += `📡 <b>Загрузка канала:</b> ${latestMetrics.channelUtilization}%\n`
        hasMetrics = true
      }
      if (latestMetrics.airUtilTx && latestMetrics.airUtilTx !== 'N/A' && latestMetrics.airUtilTx !== 0) {
        telemetrySection += `📶 <b>Эфирное время TX:</b> ${latestMetrics.airUtilTx}%\n`
        hasMetrics = true
      }

      if (hasMetrics) {
        message += telemetrySection

        // Добавляем Telemetry RX информацию
        const devRxRssi = deviceMetrics?.rxRssi
        const devRxSnr = deviceMetrics?.rxSnr
        const devHop = deviceMetrics?.hopLimit || deviceMetrics?.hop
        const devGatewayId = deviceMetrics?.gatewayId

        if (devRxRssi && devRxSnr && devRxRssi !== 'N/A' && devRxSnr !== 'N/A' && devGatewayId) {
          const gatewayInfo = gatewayInfoMap[devGatewayId]
          if (gatewayInfo) {
            message += `🛰️ <b>Telemetry RX:</b> ${gatewayInfo.longName} (${gatewayInfo.idHex}) `
            if (devHop && devHop !== 'N/A' && devHop !== null) { 
              message += `Hop: ${devHop} `
            }
            message += `RSSI/SNR: ${devRxRssi}/${devRxSnr}\n`
          }
        }
        message += '\n'
      }
    }
  }

  // === Environment секция ===
  if (environmentMetrics?.data?.variant?.value || envMetricsHistory.length > 0) {
    const latestEnv = envMetricsHistory.length > 0 ? 
      envMetricsHistory[envMetricsHistory.length - 1] : 
      environmentMetrics?.data?.variant?.value

    if (latestEnv) {
      let hasEnvMetrics = false
      let envSection = ``

      if (latestEnv.temperature && latestEnv.temperature !== 'N/A' && latestEnv.temperature !== 0) {
        envSection += `🌡️ <b>Температура:</b> ${latestEnv.temperature}°C\n`
        hasEnvMetrics = true
      }
      if (latestEnv.relativeHumidity && latestEnv.relativeHumidity !== 'N/A' && latestEnv.relativeHumidity !== 0) {
        envSection += `💧 <b>Влажность:</b> ${latestEnv.relativeHumidity}%\n`
        hasEnvMetrics = true
      }
      if (latestEnv.barometricPressure && latestEnv.barometricPressure !== 'N/A' && latestEnv.barometricPressure !== 0) {
        envSection += `🌪️ <b>Давление:</b> ${latestEnv.barometricPressure} hPa\n`
        hasEnvMetrics = true
      }
      if (latestEnv.gasResistance && latestEnv.gasResistance !== 'N/A' && latestEnv.gasResistance !== 0) {
        envSection += `💨 <b>Сопротивление газа:</b> ${latestEnv.gasResistance} Ω\n`
        hasEnvMetrics = true
      }

      if (hasEnvMetrics) {
        message += envSection

        // Добавляем Environment RX информацию
        const envRxRssi = environmentMetrics?.rxRssi
        const envRxSnr = environmentMetrics?.rxSnr
        const envHop = environmentMetrics?.hopLimit || environmentMetrics?.hop
        const envGatewayId = environmentMetrics?.gatewayId

        if (envRxRssi && envRxSnr && envRxRssi !== 'N/A' && envRxSnr !== 'N/A' && envGatewayId) {
          const gatewayInfo = gatewayInfoMap[envGatewayId]
          if (gatewayInfo) {
            message += `🛰️ <b>Environment RX:</b> ${gatewayInfo.longName} (${gatewayInfo.idHex}) `
            if (envHop && envHop !== 'N/A' && envHop !== null) { 
              message += `Hop: ${envHop} `
            }
            message += `RSSI/SNR: ${envRxRssi}/${envRxSnr}\n`
          }
        }
      }
    }
  }

  return message
}

// Функция для отправки сгруппированного сообщения
const sendGroupedMessage = async (redis, messageId) => {
  const group = messageGroups.get(messageId)
  if (!group || group.gateways.size === 0) {
    messageGroups.delete(messageId)
    return
  }

  console.log(`Sending grouped message for ID ${messageId} with ${group.gateways.size} gateways`)

  // Получаем информацию об отправителе
  const senderKey = `device:${group.event.from}`
  const senderData = await redis.hGetAll(senderKey).catch(() => ({}))

  let senderUserData
  try {
    senderUserData = JSON.parse(senderData?.user)?.data
  } catch {}

  const fromLongName = senderUserData?.longName || ''
  const fromId = senderUserData?.id || group.event.from || ''

  // Исправляем формирование hex ID - убираем двойной восклицательный знак
  let fromIdHex = ''
  if (fromId) {
    if (typeof fromId === 'string' && fromId.startsWith('!')) {
      fromIdHex = fromId
    } else {
      fromIdHex = `!${fromId.toString(16).padStart(8, '0')}`
    }
  }

  // Получаем ID без восклицательного знака для команды
  const fromIdWithoutExclamation = fromIdHex.startsWith('!') ? fromIdHex.substring(1) : fromIdHex

  // Формируем список всех получателей
  const gatewayInfos = []
  for (const [gatewayId, gatewayData] of group.gateways) {
    const info = await getGatewayInfo(redis, gatewayId)

    // Проверяем условие для замены текста
    if ((gatewayData.rxRssi === 'N/A' || gatewayData.rxRssi === 0) && (gatewayData.rxSnr === 'N/A' || gatewayData.rxSnr === 0)) {
      if(group.gateways.size > 1) gatewayInfos.push(`🛰️ <b>RX:</b> ${info.longName} (${info.idHex}) Hop: ${gatewayData.hopLimit} RSSI/SNR: ${gatewayData.rxRssi}/${gatewayData.rxSnr} <b>MQTT</b>`)
      else gatewayInfos.push(`<b>MQTT</b>`)
    } else { 
      gatewayInfos.push(`🛰️ <b>RX:</b> ${info.longName} (${info.idHex}) Hop: ${gatewayData.hopLimit} RSSI/SNR: ${gatewayData.rxRssi}/${gatewayData.rxSnr}`)
    }
  }

  // Формируем финальное сообщение БЕЗ кнопки "Инфо", но с кликабельной ссылкой на ID
  const receiversText = gatewayInfos.join('\n')
  const telegramMessage = `${receiversText}\n` +
    `📟 <b>From:</b> ${fromLongName} <a href="https://t.me/${botSettings.BOT_USERNAME}?start=${fromIdWithoutExclamation}">${fromIdHex}</a>` +
    `\n✉️ <b>Msg:</b> ${group.event.data}`

  try {
    await sendTelegramMessage(telegramMessage)
  } catch (error) {
    console.error('Error sending telegram message:', error.message)
  }

  // Удаляем группу после отправки
  messageGroups.delete(messageId)
}

// Функция для проверки топика - проверяем полный MQTT топик
const isAllowedTopic = (fullTopic) => {
  // Проверяем, что топик начинается с 'msh/msk'
  return fullTopic && fullTopic.startsWith('msh/msk')
}

export const sendTelegramMessage = async (message) => {
  if (!bot || !botSettings.ENABLE) {
    console.log('Telegram disabled, message not sent:', message)
    return
  }

  try {
    await bot.telegram.sendMessage(botSettings.CHANNEL_ID, message, {
      parse_mode: 'HTML',
      disable_web_page_preview: true
    })
    console.log('Telegram message sent successfully')
  } catch (error) {
    console.error('Error sending telegram message:', error.message)
  }
}

// Инициализация обработчиков команд бота
export const initializeTelegramBot = (redis) => {
  if (!bot || !botSettings.ENABLE) {
    return
  }

  // Обработчик команды /12aabb34
  bot.command('12aabb34', async (ctx) => {
    const message = '<b>!12aabb34</b> это пример! \nВам нужно использовать id вашего <b>meshtastic</b> устройства'
    await ctx.reply(message)
    await ctx.reply(message, { parse_mode: 'HTML' })
  })

  // Обработчик команд для статистики устройств (НОВЫЙ ФОРМАТ БЕЗ !)
  bot.hears(/^\/([0-9a-fA-F]{8})$/, async (ctx) => {
    try {
      const deviceId = `!${ctx.match[1].toLowerCase()}`
      console.log(`Received device stats request for: ${deviceId}`)

      const stats = await getDeviceStats(redis, deviceId)
      const message = await formatDeviceStats(stats, redis)

      await ctx.reply(message, { parse_mode: 'HTML' })
    } catch (error) {
      console.error('Error handling device stats command:', error.message)
      await ctx.reply('❌ Ошибка при получении статистики устройства')
    }
  })

  // Обработчик команды /start - показывает help
  bot.command('start', async (ctx) => {
    const startParam = ctx.message.text.split(' ')[1]

    if (startParam && /^[0-9a-fA-F]{8}$/.test(startParam)) {
      // Если параметр - это device ID, показываем статистику
      const deviceId = `!${startParam.toLowerCase()}`
      console.log(`Received device stats request via start for: ${deviceId}`)

      try {
        const stats = await getDeviceStats(redis, deviceId)
        const message = await formatDeviceStats(stats, redis)
        await ctx.reply(message, { parse_mode: 'HTML' })
      } catch (error) {
        console.error('Error handling device stats via start:', error.message)
        await ctx.reply('❌ Ошибка при получении статистики устройства')
      }
    } else {
      // Показываем help
      const helpMessage = `🤖 <b>Доступные команды:</b>\n\n` +
        `📊 <code>/xxxx</code> - статистика устройства (где xxxx - hex ID без !)\n` +
        `❓ <code>/help</code> - показать эту справку\n\n` +
        `<i>Пример: /12aabb34</i>`

      await ctx.reply(helpMessage, { parse_mode: 'HTML' })
    }
  })

  // Обработчик команды помощи
  bot.command('help', async (ctx) => {
    const helpMessage = `🤖 <b>Доступные команды:</b>\n\n` +
      `📊 <code>/xxxx</code> - статистика устройства (где xxxx - hex ID без !)\n` +
      `❓ <code>/help</code> - показать эту справку\n\n` +
      `<i>Пример: /12aabb34</i>`

    await ctx.reply(helpMessage, { parse_mode: 'HTML' })
  })

  // Запуск бота
  bot.launch()
  console.log('Telegram bot commands initialized')

  // Graceful shutdown
  process.once('SIGINT', () => bot.stop('SIGINT'))
  process.once('SIGTERM', () => bot.stop('SIGTERM'))
}

export const handleTelegramMessage = async (redis, server, fullTopic, event) => {
  // Проверяем, есть ли telegram флаг у сервера
  if (!server.telegram) {
    return
  }

  // Проверяем топик - отправляем в Telegram только сообщения с топиком msh/msk/*
  if (!isAllowedTopic(fullTopic)) {
    return
  }

  // Создаем уникальный ключ для сообщения (ID + gatewayId + server)
  const messageKey = `${event.id}_${event.gatewayId}_${server.name}`

  // Проверяем, не обрабатывали ли мы уже это сообщение
  if (processedMessages.has(messageKey)) {
    return
  }

  // Добавляем в список обработанных
  processedMessages.add(messageKey)

  const messageId = event.id
  const gatewayId = event.gatewayId

  // Создаем или обновляем группу сообщений
  if (!messageGroups.has(messageId)) {
    messageGroups.set(messageId, {
      event: event,
      gateways: new Map(),
      timeout: null
    })
  }

  const group = messageGroups.get(messageId)

  // Добавляем шлюз в группу (если еще не добавлен)
  if (!group.gateways.has(gatewayId)) {
    group.gateways.set(gatewayId, {
      hopLimit: event.hopLimit,
      rxRssi: event.rxRssi,
      rxSnr: event.rxSnr,
      server: server.name
    })

    console.log(`Added gateway ${gatewayId} to message group ${messageId}. Total gateways: ${group.gateways.size}`)
  }

  // Сбрасываем таймер
  if (group.timeout) {
    clearTimeout(group.timeout)
  }

  // Устанавливаем новый таймер для отправки сообщения
  group.timeout = setTimeout(() => {
    sendGroupedMessage(redis, messageId)
  }, MESSAGE_GROUP_TIMEOUT)
}