import { Telegraf, session, Markup } from "telegraf";
import { createClient } from "@supabase/supabase-js";
import fetch from "node-fetch";

// --- Supabase Client ---
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// --- Telegram Bot ---
const bot = new Telegraf(process.env.BOT_TOKEN);
bot.use(session());

// Start add product flow
bot.command("addproduct", (ctx) => {
  ctx.session = { step: "name", product: {} };
  ctx.reply("📌 Send product name:");
});

// Handle text inputs
bot.on("text", async (ctx) => {
  if (!ctx.session || !ctx.session.step) return;

  const text = ctx.message.text;

  switch (ctx.session.step) {
    case "name":
      ctx.session.product.name = text;
      ctx.session.step = "description";
      return ctx.reply("✏️ Send product description:");

    case "description":
      ctx.session.product.description = text;
      ctx.session.step = "price";
      return ctx.reply("💰 Send product price:");

    case "price":
      ctx.session.product.price = parseFloat(text);
      ctx.session.step = "discount";
      return ctx.reply("🔖 Send discount (%):");

    case "discount":
      ctx.session.product.discount = parseInt(text);
      ctx.session.step = "badge";
      return ctx.reply(
        "🏷️ Choose a badge:",
        Markup.inlineKeyboard([
          [Markup.button.callback("🆕 New Arrival", "badge_New Arrival")],
          [Markup.button.callback("🔥 Limited Offer", "badge_Limited Offer")],
          [Markup.button.callback("📈 Trending", "badge_Trending")],
          [Markup.button.callback("⭐ Best Seller", "badge_Best Seller")],
        ])
      );

    case "affiliate":
      ctx.session.product.affiliate = text;
      ctx.session.step = "image";
      return ctx.reply("📸 Now send product image:");
  }
});

// Handle badge selection
bot.action(/badge_(.+)/, async (ctx) => {
  ctx.session.product.badge = ctx.match[1];
  ctx.session.step = "affiliate";
  await ctx.answerCbQuery();
  return ctx.reply("🔗 Send affiliate link:");
});

// Handle image upload
bot.on("photo", async (ctx) => {
  if (!ctx.session || ctx.session.step !== "image") return;

  const fileId = ctx.message.photo.pop().file_id;
  const fileLink = await ctx.telegram.getFileLink(fileId);

  // Download image
  const response = await fetch(fileLink.href);
  const buffer = Buffer.from(await response.arrayBuffer());

  const filePath = `products/${Date.now()}.jpg`;

  // Upload to Supabase storage
  const { error: uploadError } = await supabase.storage
    .from("product-images")
    .upload(filePath, buffer, {
      contentType: "image/jpeg",
      upsert: true,
    });

  if (uploadError) {
    return ctx.reply("❌ Image upload failed: " + uploadError.message);
  }

  const { data: publicUrl } = supabase.storage
    .from("product-images")
    .getPublicUrl(filePath);

  // Save product to DB
  const { error } = await supabase.from("products").insert([
    {
      product_name: ctx.session.product.name,
      description: ctx.session.product.description,
      price: ctx.session.product.price,
      discount: ctx.session.product.discount,
      affiliate_link: ctx.session.product.affiliate,
      badge: ctx.session.product.badge,
      image_url: publicUrl.publicUrl,
    },
  ]);

  if (error) {
    return ctx.reply("❌ Failed to save product: " + error.message);
  }

  // Ask if user wants to add more
  ctx.reply(
    "✅ Product added successfully!\nDo you want to add another product?",
    Markup.inlineKeyboard([
      [Markup.button.callback("✅ Yes", "add_more")],
      [Markup.button.callback("❌ No", "add_done")],
    ])
  );
  ctx.session.step = "done";
});

// Handle add more or done
bot.action("add_more", (ctx) => {
  ctx.session = { step: "name", product: {} };
  ctx.answerCbQuery();
  ctx.reply("📌 Send product name:");
});

bot.action("add_done", (ctx) => {
  ctx.session = null;
  ctx.answerCbQuery();
  ctx.reply("🎉 All products added successfully!");
});

bot.launch();
