export const api = {
  BOT_TOKEN: '6521340072:AAHQAUAC_VTJNQIsHExqfYLMviM6-mHiFEM',
  // CHANNEL_ID: '-4157505313' // группа я и фадеев id: -4157505313
  CHANNEL_ID: '-1001592258392' // group of moscow
}

export const servers = [
  {
    address: 'mqtt://admin:meshtastic@meshtastic.taubetele.com',
    name: 'meshtastic.taubetele.com',
    type: 'mqtt',
    telegram: true
  },
  {
    address: 'mqtt://meshdev:large4cats@mqtt.meshtastic.pt',
    name: 'mqtt.meshtastic.pt',
    type: 'mqtt'
  },
  {
    address: 'mqtt://meshdev:large4cats@mqtt.meshtastic.org',
    name: 'mqtt.meshtastic.org',
    type: 'mqtt'
  },
  {
    address: 'mqtt://mthub.monteops.com',
    name: 'mthub.monteops.com',
    type: 'mqtt'
  }
  // },
  // {
  //     address: 'kabramov.ru:5555',
  //     name: 'kabramov.ru',
  //     type: 'protobuf',
  // }
]

export const redisConfig = {
  url: 'redis://172.16.0.10:6379',
  ttl: 60 * 60 * 3 // 3 hours in seconds // попадает в createClient да и хуй с ним
}
