import { Keyboard, InlineKeyboard } from 'grammy';
import { t } from '@/lib/i18n';

export function getMainMenu(role: string, lang: string = 'en') {
    const l = lang as any;
    const keyboard = new Keyboard()
        .text(t(l, 'balance_btn')).text(t(l, 'topup_btn')).row()
        .text(t(l, 'my_subs_btn')).row()
        .text(t(l, 'history_btn')).text(t(l, 'settings_btn')).row()
        .text(t(l, 'invite_btn')).text(t(l, 'how_to_use_btn')).row()
        .text(t(l, 'leaderboard_btn'));

    if (role === 'merchant') {
        keyboard.row().text(t(l, 'menu_merchant'));
    }

    return keyboard.resized();
}

export function getMerchantMenu(lang: string = 'en') {
    const l = lang as any;
    return new Keyboard()
        .text(t(l, 'balance_btn')).row()
        .text(t(l, 'merchant_menu_invoice')).text(t(l, 'merchant_menu_report')).row()
        .text(t(l, 'merchant_menu_channels')).row() // Add Channels
        .text(t(l, 'merchant_menu_edit_name')).row()
        .text(t(l, 'switch_to_user'))
        .resized();
}

export function getInvoiceMenu(lang: string = 'en') {
    const l = lang as any;
    return new Keyboard()
        .text(t(l, 'invoice_create')).text(t(l, 'invoice_view')).row()
        .text(t(l, 'back_merchant')).text(t(l, 'back_main'))
        .resized();
}

export function getInvoiceTypeMenu(lang: string = 'en') {
    const l = lang as any;
    return new Keyboard()
        .text(t(l, 'invoice_type_onetime')).text(t(l, 'invoice_type_reusable')).row()
        .text(t(l, 'back_merchant')).text(t(l, 'back_main')) // Home added
        .resized();
}

export function getBackMerchantKeyboard(lang: string = 'en') {
    const l = lang as any;
    return new Keyboard()
        .text(t(l, 'back_merchant'))
        .resized();
}

export function getCancelKeyboard(lang: string = 'en') {
    const l = lang as any;
    return new Keyboard()
        .text(t(l, 'cancel'))
        .resized();
}

export function getPaginationKeyboard(page: number, totalPages: number, prefix: string) {
    const kb = new InlineKeyboard();

    // Rows:
    // [ < Prev ] [ 1/5 ] [ Next > ]

    if (page > 1) {
        kb.text("⬅️ Prev", `${prefix}_page_${page - 1}`);
    }

    kb.text(`${page} / ${totalPages}`, "noop");

    if (page < totalPages) {
        kb.text("Next ➡️", `${prefix}_page_${page + 1}`);
    }

    return kb;
}

export function getProviderKeyboard(lang: string = 'en') {
    const l = lang as any;
    return new Keyboard()
        .text(t(l, 'provider_kpay')).text(t(l, 'provider_wave')).row()
        .text(t(l, 'cancel'))
        .resized();
}

export function getTopupAmountsKeyboard(lang: string = 'en') {
    const l = lang as any;
    return new Keyboard()
        .text("5,000").text("10,000").row()
        .text("30,000").text("50,000").row()
        .text("Custom Amount").row()
        .text(t(l, 'cancel'))
        .resized();
}

export function getCancelInlineKeyboard(lang: string = 'en') {
    const l = lang as any;
    return new InlineKeyboard()
        .text(t(l, 'cancel') || "Cancel", "cancel_topup_upload");
}
