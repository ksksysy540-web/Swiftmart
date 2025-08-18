import 'dotenv/config'
import TelegramBot from 'node-telegram-bot-api'
import { createClient } from '@supabase/supabase-js'

// --- Supabase setup ---
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
)

// --- Telegram Bot setup ---
const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true })

// --- User session store (in-memory) ---
const userSessions = {}

// Start command
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, '👋 Welcome! Type /addproduct to add a new product.')
})

// Add product command
bot.onText(/\/addproduct/, (msg) => {
  const chatId = msg.chat.id
  userSessions[chatId] = { step: 'name', data: {} }
  bot.sendMessage(chatId, '📦 Please enter product *name*:', { parse_mode: 'Markdown' })
})

// Handle text messages step by step
bot.on('message', async (msg) => {
  const chatId = msg.chat.id
  const session = userSessions[chatId]

  if (!session || msg.text.startsWith('/')) return

  switch (session.step) {
    case 'name':
      session.data.name = msg.text
      session.step = 'description'
      bot.sendMessage(chatId, '📝 Enter product *description*:', { parse_mode: 'Markdown' })
      break

    case 'description':
      session.data.description = msg.text
      session.step = 'price'
      bot.sendMessage(chatId, '💰 Enter product *price*:', { parse_mode: 'Markdown' })
      break

    case 'price':
      session.data.price = parseFloat(msg.text)
      session.step = 'discount'
      bot.sendMessage(chatId, '🔖 Enter *discount* percentage (0 if none):', { parse_mode: 'Markdown' })
      break

    case 'discount':
      session.data.discount = parseFloat(msg.text)
      session.step = 'badge'
      bot.sendMessage(chatId, '🏷 Select a *badge*:', {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '🆕 New Arrival', callback_data: 'New Arrival' }],
            [{ text: '🔥 Trending', callback_data: 'Trending' }],
            [{ text: '⭐ Best Seller', callback_data: 'Best Seller' }],
            [{ text: '⏳ Limited Offer', callback_data: 'Limited Offer' }],
          ]
        }
      })
      break

    case 'affiliate':
      session.data.affiliate_link = msg.text
      session.step = 'image'
      bot.sendMessage(chatId, '🖼 Please upload a product *image*:', { parse_mode: 'Markdown' })
      break
  }
})

// Handle badge selection
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id
  const session = userSessions[chatId]
  if (!session) return

  if (session.step === 'badge') {
    session.data.badge = query.data
    session.step = 'affiliate'
    bot.sendMessage(chatId, '🔗 Please provide *affiliate link*:', { parse_mode: 'Markdown' })
  }

  bot.answerCallbackQuery(query.id)
})

// Handle image upload
bot.on('photo', async (msg) => {
  const chatId = msg.chat.id
  const session = userSessions[chatId]
  if (!session || session.step !== 'image') return

  const fileId = msg.photo[msg.photo.length - 1].file_id
  const file = await bot.getFile(fileId)
  const imageUrl = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${file.file_path}`

  session.data.image_url = imageUrl

  // --- Insert into Supabase ---
  const { error } = await supabase.from('products').insert([session.data])
  if (error) {
    bot.sendMessage(chatId, '❌ Error saving product: ' + error.message)
  } else {
    bot.sendMessage(chatId, '✅ Product added successfully!')
  }

  delete userSessions[chatId]
})