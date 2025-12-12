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
    pay_confirm: "💸 Yes, Pay (Final)",
    payment_success: "Payment Successful!",
    payment_failed: "Payment Failed.",
    insufficient_funds: "Insufficient funds.",
    account_frozen: "Your account is frozen.",
    error_generic: "An error occurred.",

    // Menus
    menu_balance: "💰 Balance",
    menu_topup: "➕ Top up",
    menu_history: "📜 History",
    menu_settings: "⚙️ Settings",
    menu_merchant: "🏪 Merchant Area",

    // Balance
    balance_text: "Your Balance: ${amount} MMK.",
    withdraw_btn: "📤 Withdraw",

    // Topup
    topup_intro: "Top Up Rules:\nMinimum: 3,000 MMK.\n\nType /cancel to stop.",
    topup_payment_info: "🏦 **Payment Account**:\nKPay: 0912345678 (Mr. Admin)\nWave: 0912345678\n\nPlease transfer amount and upload screenshot.",
    enter_topup_amount: "Please enter amount (MMK):",
    enter_proof: "Please upload the payment receipt (Photo).",
    topup_submitted: "✅ Receipt received! Admin is verifying...",
    topup_rejected_reason: "❌ Topup Rejected.\nReason: {reason}",
    admin_reject_reason_prompt: "Please enter rejection reason:",
    cancel: "❌ Cancel",

    // Settings
    settings_add_account: "➕ Add Payment Account",

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
    back_main: "🔙 Main Menu",
    switch_to_user: "👤 Switch to User",
    back_merchant: "🔙 Back to Merchant",
    invoice_type_onetime: "1️⃣ One Time",
    invoice_type_reusable: "🔁 Reusable",
    select_invoice_type: "Select Invoice Type:",
    enter_invoice_amount: "Enter Invoice Amount (MMK):"
};
