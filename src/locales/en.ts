export const en = {
    welcome: "👋 Hey there! Welcome to TelePayments!",
    tos_intro: "Quick thing before we start — please read and accept our Terms of Service.",
    tos_text: "📜 <b>Terms of Service</b>\n\n• We are a <b>payment bridge only</b> — we process transactions between you and channel owners.\n• We do NOT control channel content, delivery, or quality.\n• <b>All payments are final</b> — we cannot reverse transactions.\n• If a merchant removes you unfairly, report to us — we may freeze their funds.\n• Always verify the channel before subscribing.\n\n⚠️ <b>Scam Warning:</b> Some sellers may not deliver as promised. Only pay if you trust them!",
    tos_agree: "✅ I Understand & Accept",
    tos_rejected: "No worries! But you'll need to accept the Terms to continue.",
    merchant_rules: "📋 <b>Merchant Guidelines</b>\n\n• ❌ Illegal/scam content = Instant ban + funds frozen\n• 💰 5% withdrawal fee\n• ⏱ Withdrawals processed within 24h\n• 🔒 Funds may be held if disputes arise\n• 🚫 Kicking paid subscribers = Account termination",
    merchant_agree: "✅ I Accept & Continue",
    merchant_success: "🎉 Awesome! You're now a verified merchant!",
    invoice_title: "Payment Invoice",
    pay_warning: "⚠️ <b>Before You Pay</b>\n\n👤 Sending to: [Merchant Name]\n\n• This payment is <b>FINAL</b> and cannot be reversed\n• We are just the payment bridge\n• <b>We cannot guarantee</b> the seller will deliver\n\n❓ Do you trust this seller?",
    pay_cancel: "❌ Nevermind",
    pay_confirm: "💸 Yes, Pay Securely",
    payment_success: "✅ Done! Payment sent successfully.",
    payment_failed: "😕 Payment failed. Please check your balance and try again.",
    insufficient_funds: "💰 Not enough balance.",
    account_frozen: "🔒 Your account is currently frozen. Please contact support.",
    error_generic: "😅 Oops! Something went wrong. Please try again.",

    // Menus
    menu_balance: "💰 Balance",
    menu_topup: "💳 Top Up",
    menu_history: "📜 History",
    menu_settings: "⚙️ Settings",
    menu_merchant: "🏪 Merchant Area",

    // New Standard Keys
    balance_btn: "💰 Balance",
    topup_btn: "💳 Top Up",
    history_btn: "📜 History",
    settings_btn: "⚙️ Settings",
    channel_plans_btn: "📺 Channel Plans",
    my_subs_btn: "📂 My Subscriptions",
    explore_btn: "🔍 Explore",
    invite_btn: "🎁 Invite Friends",
    leaderboard_btn: "🏆 Leaderboard",

    // Logic Msgs
    no_subs: "📭 No subscriptions yet!\n\nTap 🔍 Explore to discover amazing channels.",
    no_more_results: "That's all for now!",
    sub_history_title: "📂 Your Subscriptions",
    sub_active: "Active ✓",
    sub_expired: "Expired",

    // Balance
    balance_text: "💰 Your Balance: <b>{amount} MMK</b>",
    withdraw_btn: "📤 Withdraw",

    // Topup
    topup_intro: "💳 <b>Top Up Your Wallet</b>\n\n• Minimum: 3,000 MMK\n• Funds are held securely until verified\n\nType /cancel anytime to stop.",
    admin_kpay_info: "🏦 <b>KBZ Pay</b>\nName: Mr. Admin\nAccount: 0912345678\n\n💡 Transfer to this account, then upload your receipt.",
    admin_wave_info: "💸 <b>Wave Pay</b>\nName: Mr. Admin\nAccount: 0912345678\n\n💡 Transfer to this account, then upload your receipt.",
    enter_topup_amount: "💵 How much did you transfer? (MMK)",
    enter_proof: "📸 Please upload your payment receipt (photo).",
    topup_submitted: "✅ Got it! We're verifying your payment...\n\nThis usually takes just a few minutes.",
    topup_rejected_reason: "❌ Sorry, your top-up was declined.\n\n📝 Reason: {reason}",
    admin_reject_reason_prompt: "Please enter rejection reason:",
    cancel: "❌ Cancel",
    select_provider_topup: "📲 Choose your payment method:",

    // Settings
    settings_add_account: "➕ Add Payment Account",
    settings_remove_account: "🗑 Remove Account",
    select_provider: "📲 Select Payment Provider:",
    provider_kpay: "KBZ Pay",
    provider_wave: "Wave Pay",
    enter_account_name: "👤 Enter Account Name (e.g. U Mya):",
    enter_account_number: "📱 Enter Phone Number (e.g. 09123456789):",
    account_added: "✅ Payment Account Saved!\n\n{account}",
    error_invalid_phone_format: "❌ Invalid number format.\n\nPlease use: 09xxxxxxxx, 959xxxxxxxx, or +959xxxxxxxx",

    // Merchant
    merchant_menu_invoice: "🧾 Invoices",
    merchant_menu_report: "📊 Reports",
    merchant_menu_edit_name: "📝 Edit Business Name",
    merchant_edit_name_prompt: "✏️ Enter your new Business Name:",
    merchant_edit_name_success: "✅ Updated! Your business is now: {name}",

    // Onboarding
    merchant_onboarding_name: "🏪 What's your business name?",
    merchant_onboarding_channel: "📢 Got a Telegram channel? Paste the link!\n\n(e.g. https://t.me/yourshop)\n\nType 'skip' if you don't have one.",
    merchant_completed: "🎉 All set! Welcome to the Merchant family!",

    invoice_create: "➕ Create Invoice",
    invoice_view: "👀 View Invoices",
    back_main: "🏠 Home",
    switch_to_user: "👤 Switch to User",
    back_merchant: "🔙 Back",
    invoice_type_onetime: "1️⃣ One-Time",
    invoice_type_reusable: "🔁 Reusable",
    select_invoice_type: "📝 What type of invoice?",
    enter_invoice_amount: "💵 Enter amount (MMK):",

    // Channels
    merchant_menu_channels: "📢 My Channels",
    channel_list_empty: "📭 No channels yet!\n\nTap below to add your first channel.",
    channel_add_btn: "➕ Add Channel",
    channel_add_prompt: "📢 <b>Add Your Channel</b>\n\n1️⃣ Add this bot as an Admin in your channel\n2️⃣ Send me the channel username (e.g. @mychannel)\n   or forward any message from it",
    channel_add_success: "✅ Nice! '{title}' is now connected!",
    channel_add_fail: "❌ Couldn't verify the channel.\n\nMake sure I'm an Admin there!",

    // Plans
    plan_menu_title: "📋 Plans for {channel}:",
    plan_add_btn: "➕ Add Plan",
    plan_duration_prompt: "⏱ How long should this plan last?",
    plan_price_prompt: "💵 Set the price (MMK):",
    plan_created: "✅ Plan created successfully!",

    // Subscription User Flow
    sub_intro: "📢 <b>{channel}</b>\n\nPick a plan to subscribe:",
    sub_plan_btn: "{duration} Months — {price} MMK",
    sub_confirm: "Subscribe for {price} MMK?",
    sub_success: "🎉 You're in!\n\nHere's your invite link:\n{link}\n\n⚠️ This link expires in 24h — join now!",
    sub_fail_balance: "💰 Not enough balance.\n\nTap 💳 Top Up to add funds!",

    // Onboarding
    how_to_use_btn: "❓ How to Use",
    onboard_cap_1: "1️⃣ <b>Top Up</b> — Add funds via KPay or Wave",
    onboard_cap_2: "2️⃣ <b>Browse</b> — Find premium channels you'll love",
    onboard_cap_3: "3️⃣ <b>Subscribe</b> — Get instant access & enjoy!",

    // Explore Categories
    explore_title: "🔍 <b>Explore Channels</b>\n\nPick a category:",
    explore_no_channels: "😕 No channels here yet. Check back soon!",
    cat_entertainment: "🎬 Entertainment",
    cat_education: "📚 Education",
    cat_business: "💼 Business",
    cat_gaming: "🎮 Gaming",
    cat_lifestyle: "🌟 Lifestyle",
    cat_other: "📦 Other",
    cat_all: "📋 All Channels"
};

