import mqtt from 'mqtt'
import { Protobuf, IHTTPConnection, IMeshDevice } from '@meshtastic/meshtasticjs'

const MIN_LOG_LEVEL = 10

const listenToProtobufEvents = (server, connection, callback) => {
  const events = Object.keys(connection.events)

  events.forEach(eventName => {
    connection.events[eventName].subscribe((event) => {
      const { mqttChannel, mqttUser, ...rest } = event
      const eventType = event.data.constructor.name
      // console.log(eventName, event.data.constructor.name, event.data.constructor.typeName);
      callback(server, mqttChannel, mqttUser, eventName, eventType, rest)
    })
  })
}

const connectToProtobufServer = (server, callback) => {
  const connection = new IHTTPConnection()

  connection.log.settings.minLevel = MIN_LOG_LEVEL

  void connection.connect({
    address: server.address,
    fetchInterval: 3000
  })

  listenToProtobufEvents(server, connection, callback)
}

const handleProtobufServiceEnvelopePacket = (channel, user, device, arrayBuffer) => {
  try {
	    const serviceEnvelope = Protobuf.ServiceEnvelope.fromBinary(arrayBuffer)
	    const meshPacket = serviceEnvelope.packet
	    const { rxSnr, hopLimit, wantAck, rxRssi } = meshPacket

    if (meshPacket.payloadVariant.case === 'decoded') {
      // добавил в iMeshDevice:handleDecodedPacket параметр additionalInfo
      // если библиотеку обновить, то ничего страшного не случится
      // для raw mqtt пакетов не будут доступны mqttChannel и mqttUser
      device.handleDecodedPacket(meshPacket.payloadVariant.value, meshPacket, { mqttChannel: channel, mqttUser: user, rxSnr, hopLimit, wantAck, rxRssi })
    } else {
      // console.warn('!!! not decoded', JSON.stringify(serviceEnvelope, null, 2));
    }
  } catch (error) {
    // console.error(error, JSON.stringify(serviceEnvelope, null, 2))
  }
}

const connectToMqtt = (server, callback) => {
  const device = new IMeshDevice()

  device.log.settings.minLevel = MIN_LOG_LEVEL

  listenToProtobufEvents(server, device, callback)

  // todo add reconnection
  const client = mqtt.connect(server.address)

  client.on('connect', () => {
    client.subscribe('#', (err) => {
      if (!err) {
        console.debug(`Connected to ${server.name}`)
      }
    })
  })

  client.on('message', (topic, payload, raw) => {
    const [, , type, channel, user] = topic.split('/')

    if (type === 'stat') {
      return
    }

    if (type === 'json') {
      callback(server, channel, user, 'json', 'json', JSON.parse(payload.toString()))
      return
    }

    handleProtobufServiceEnvelopePacket(channel, user, device, new Uint8Array(payload))
  })

  client.on('error', (error) => {
    // console.error(error);
  })
}

export const listenToEvents = (serversConfig, callback) => {
  serversConfig.forEach(server => {
    switch (server.type) {
      case 'mqtt': connectToMqtt(server, callback); break
      case 'protobuf': connectToProtobufServer(server, callback); break
      default: console.warn('unsupported server config', server)
    }
  })
}
