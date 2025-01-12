import { Telegraf } from 'telegraf'
import { botSettings } from './config.mjs'

import TimeAgo from 'javascript-time-ago'
import en from 'javascript-time-ago/locale/en'

TimeAgo.addDefaultLocale(en) // Create formatter (English).
// const timeAgo = new TimeAgo('en-US')

const bot = new Telegraf(botSettings.BOT_TOKEN)

bot.catch((err, ctx) => {
  console.log(`!!! Bot Catched ERROR: ${err}`)
})

// bot.command('inline', (ctx) => {
//   ctx.reply('Hi there!', {
//     reply_markup: {
//       inline_keyboard: [
//         /* Inline buttons. 2 side-by-side */
//         [{ text: 'Button 1', callback_data: 'btn-1' }, { text: 'Button 2', callback_data: 'btn-2' }],

//         /* One button */
//         [{ text: 'Next', callback_data: 'next' }],

//         /* Also, we can have URL buttons. */
//         [{ text: 'Open in browser', url: 'telegraf.js.org' }]
//       ]
//     }
//   })
// })

// bot.on('message', async function (msg) {
//   const from = msg.text.substr(1) // /3663493320, drop "/"
//   if (/^\d+$/.test(from)) {
//     const key = `device:${from}`
//     const redis = await connectToRedis()
//     // console.log(await redis.keys('device:' + from))
//     redis.hGetAll(key).then((answer) => {
//       if (answer?.user) {
//         console.log(answer)
//         const userData = JSON.parse(answer.user)
//         // const positionData = JSON.parse(answer.position)

//         if (userData && userData.data && userData.data.longName) {
//           console.log(userData, answer.timestamp, timeAgo.format(new Date(answer.timestamp).getTime()))
//           msg.reply('longName: ' + userData.data.longName + ' (Last message recived: ' + timeAgo.format(new Date(answer.timestamp).getTime()) + ')')
//         }
//       } else { msg.reply('404 Not Found') }
//     })
//   } else {
//     await msg.reply('Пожалуйста введите ID ноды цифрами! Например 999999999')
//   }
// })

bot.start(ctx => {
  ctx.reply('Welcome, bro')
})

process.once('SIGINT', () => bot.stop('SIGINT'))
process.once('SIGTERM', () => bot.stop('SIGTERM'))

bot.launch()

export function sendTelegramMessage (data) {
  console.log('!!!', data)
  if (botSettings.ENABLE) {
    bot.telegram.sendMessage(
      botSettings.CHANNEL_ID,
      data
    )
    // console.log('✉️ ' + longName + ': ' + event.data)
  }
}
