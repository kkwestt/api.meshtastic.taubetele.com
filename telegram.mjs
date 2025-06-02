import { Telegraf } from 'telegraf'
import { botSettings } from './config.mjs'

const bot = new Telegraf(botSettings.BOT_TOKEN)

bot.catch((err, ctx) => {
  console.error('Telegram Bot Error:', err.message)
})

bot.start(ctx => {
  ctx.reply('Meshtastic Monitor Bot is online! 🛰️')
})

// Graceful shutdown
const gracefulShutdown = () => {
  console.log('Shutting down Telegram bot...')
  bot.stop()
}

process.once('SIGINT', gracefulShutdown)
process.once('SIGTERM', gracefulShutdown)

// Launch bot with error handling
bot.launch().catch(error => {
  console.error('Failed to launch Telegram bot:', error.message)
})

export function sendTelegramMessage (data) {
  if (!botSettings.ENABLE) return

  console.log('Sending Telegram message:', data)

  bot.telegram.sendMessage(botSettings.CHANNEL_ID, data)
    .then((message) => {
      // Auto-delete message after 72 minutes (4320000ms)
      setTimeout(() => {
        bot.telegram.deleteMessage(botSettings.CHANNEL_ID, message.message_id)
          .catch(error => console.error('Failed to delete message:', error.message))
      }, 4320000)
    })
    .catch(error => {
      console.error('Failed to send Telegram message:', error.message)
    })
}
