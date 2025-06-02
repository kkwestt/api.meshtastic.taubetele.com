function lowerCaseFirstLetter (string) {
  return string.charAt(0).toLowerCase() + string.slice(1)
}

// базовая фильтрация типов и нейминг
// в идеале, не нужно подписавыться на mqtt.json и подписавывать только на необходимые callback из meshtastic.js

export function getEventType (eventName, eventType, event) {
  if (eventType === 'json') {
    // if (event.type === '') return
    // console.log(eventName, event)
    return
  }

  // console.log(eventName, event)

  if (event.from === 4184512284 || event.from === 220300 || event.from === 7 || event.from === 4) return // baned guy's

  if (event.from < 100000) { // фильтр от бракованных нод таких как 4, 554 и т д. Поле from долно быть длинным 6-9 знаков.
    // console.log('ERROR Message from brocken ID:', event.from, event)
    return
  }

  if (eventType === 'routing') {
    // это пинг откого и кого, ответ либо  {"errorReason":"NO_RESPONSE"} либо {"errorReason":"NONE"}
    // тут также есть hop и rssi+snr
    return
  }

  if (eventName === 'onStoreForwardPacket') {
    return
  }

  let type = lowerCaseFirstLetter(eventType)

  if (event?.data?.variant?.case === 'deviceMetrics') {
    type = 'deviceMetrics'
  }

  if (event?.data?.variant?.case === 'environmentMetrics') {
    type = 'environmentMetrics'
  }

  if (eventName === 'onRangeTestPacket') {
    type = 'rangeTest'
  }
  if (eventName === 'onMessagePacket') {
    type = 'message'
    // console.log(eventName, event)
  }

  // if (eventName === 'deviceMetadata') {
  //   console.log('!!! deviceMetadata', event)
  // type = 'deviceMetadata'
  // }
  // if (eventName === 'routeDiscovery') {
  //   console.log('!!! routeDiscovery', event)
  // type = 'routeDiscovery'
  // }

  return type
}




const BANNED_IDS = new Set([4184512284, 220300, 7, 4])
const MIN_VALID_ID = 10000

function lowerCaseFirstLetter(string) {
  return string.charAt(0).toLowerCase() + string.slice(1)
}
