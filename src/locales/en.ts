export const en = {
    welcome: "Welcome to TelePayments Bridge Bot.\n\nType /start to begin.",
    tos_intro: "Before you proceed, you must accept our Terms of Service.",
    tos_text: "By using this bot, you acknowledge that we are a payment bridge only. We are NOT responsible for goods delivery, quality, or scams. All payments are final.",
    tos_agree: "✅ I Agree & Continue",
    tos_rejected: "You must accept the Terms of Service to use this bot.",
    merchant_rules: "Merchant Rules:\n1. Illegal goods = Ban.\n2. 5% Withdrawal Fee.\n3. Withdrawals take 24h.\n4. We hold the right to freeze funds if fraud is reported.",
    merchant_agree: "✅ Accept Merchant Rules",
    merchant_success: "You are now a registered merchant!",
    invoice_title: "Payment Invoice",
    pay_warning: "You are sending money to [Merchant Name]. This transaction is IRREVERSIBLE. The platform is NOT responsible if the merchant does not deliver. Do you trust this person?",
    pay_cancel: "❌ Cancel",
    pay_confirm: "💸 Yes, Secure Pay",
    payment_success: "✅ Payment Successful! Your funds are safe.",
    payment_failed: "Payment Failed. Please try again.",
    insufficient_funds: "Insufficient funds.",
    account_frozen: "Your account is frozen.",
    error_generic: "An error occurred.",

    // Menus
    menu_balance: "💰 Balance", // Legacy?
    menu_topup: "➕ Top up",
    menu_history: "📜 History",
    menu_settings: "⚙️ Settings",
    menu_merchant: "🏪 Merchant Area",

    // New Standard Keys
    balance_btn: "💰 Balance",
    topup_btn: "➕ Top up",
    history_btn: "📜 History",
    settings_btn: "⚙️ Settings",
    channel_plans_btn: "📺 Channel Plans",
    my_subs_btn: "📂 My Subscriptions",
    invite_btn: "🎁 Invite Friends",
    leaderboard_btn: "🏆 Leaderboard",

    // Logic Msgs
    no_subs: "You have no active subscriptions.",
    no_more_results: "No more results.",
    sub_history_title: "📂 My Subscriptions",
    sub_active: "Active",
    sub_expired: "Expired",

    // Balance
    balance_text: "Your Balance: ${amount} MMK.",
    withdraw_btn: "📤 Withdraw",

    // Topup
    topup_intro: "Top Up Rules:\nMinimum: 3,000 MMK.\nYour funds are held securely until verified.\n\nType /cancel to stop.",
    // topup_payment_info: DEPRECATED or used as fallback
    admin_kpay_info: "🏦 **Admin KBZ Pay**\nName: Mr. Admin\nAccount: 0912345678\n\nPlease transfer to this official account.",
    admin_wave_info: "money_with_wings **Admin Wave Pay**\nName: Mr. Admin\nAccount: 0912345678\n\nPlease transfer to this official account.",
    enter_topup_amount: "Please enter transferred amount (MMK):",
    enter_proof: "Please upload the payment receipt (Photo).",
    topup_submitted: "✅ Receipt Received! Our team is verifying it securely...",
    topup_rejected_reason: "❌ Topup Rejected.\nReason: {reason}",
    admin_reject_reason_prompt: "Please enter rejection reason:",
    cancel: "❌ Cancel",
    select_provider_topup: "Select Payment Method for Top Up:",

    // Settings
    settings_add_account: "➕ Add Payment Account",
    settings_remove_account: "🗑 Remove Account",
    select_provider: "Select Payment Provider:",
    provider_kpay: "KBZ Pay",
    provider_wave: "Wave Pay",
    enter_account_name: "Enter Account Name (e.g. U Mya):",
    enter_account_number: "Enter Account Number (e.g. 0912345678):",
    account_added: "✅ Payment Account Saved Securely:\n{account}",
    error_invalid_phone_format: "Invalid format. Number must start with 09, 959, or +959 and contain only digits.",

    // Merchant
    // Merchant
    merchant_menu_invoice: "🧾 Invoices",
    merchant_menu_report: "📊 Report",
    merchant_menu_edit_name: "📝 Edit Business Name",
    merchant_edit_name_prompt: "Please enter your new Business Name:",
    merchant_edit_name_success: "Business Name updated to: {name}",

    // Onboarding
    merchant_onboarding_name: "Please enter your Business Name:",
    merchant_onboarding_channel: "Please enter your Telegram Channel Link (e.g. https://t.me/shop).\nType 'skip' if none.",
    merchant_completed: "✅ Setup Complete. Welcome Merchant!",

    invoice_create: "➕ Create Invoice",
    invoice_view: "👀 View Invoices",
    back_main: "🏠 Home",
    switch_to_user: "👤 Switch to User",
    back_merchant: "🔙 Menu",
    invoice_type_onetime: "1️⃣ One Time",
    invoice_type_reusable: "🔁 Reusable",
    select_invoice_type: "Select Invoice Type:",
    enter_invoice_amount: "Enter Invoice Amount (MMK):",

    // Channels
    merchant_menu_channels: "📢 Manage Channels",
    channel_list_empty: "You have no connected channels.",
    channel_add_btn: "➕ Add Channel",
    channel_add_prompt: "To add a channel:\n1. Add this bot to your channel as Administrator.\n2. Then, enter the Channel Username (e.g. @mychannel) or Forward a message from it.",
    channel_add_success: "✅ Channel '{title}' added!",
    channel_add_fail: "❌ Could not verify channel. Make sure I am Admin.",

    // Plans
    plan_menu_title: "Plans for {channel}:",
    plan_add_btn: "➕ Add Plan",
    plan_duration_prompt: "Select plan duration:",
    plan_price_prompt: "Enter price in MMK (e.g. 5000):",
    plan_created: "✅ Plan created!",

    // Subscription User Flow
    sub_intro: "📢 **{channel}**\n\nChoose a subscription plan:",
    sub_plan_btn: "{duration} Months - {price} MMK",
    sub_confirm: "Confirm subscription for {price} MMK?",
    sub_success: "✅ Subscription Active! Enjoy your premium content.\n\nHere is your ONE-TIME invite link:\n{link}\n\n(Link expires in 24h, please join immediately!)",
    sub_fail_balance: "Insufficient Balance. Please Top Up.",

    // Onboarding
    how_to_use_btn: "❓ How to Use",
    onboard_cap_1: "1️⃣ **Top Up**: Add funds securely via KPay or Wave.",
    onboard_cap_2: "2️⃣ **Browse**: Choose from our premium channels.",
    onboard_cap_3: "3️⃣ **Enjoy**: Get instant access link & enjoy content!"
};
