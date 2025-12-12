import { Keyboard, InlineKeyboard } from 'grammy';
import { t } from '@/lib/i18n';

export function getMainMenu(role: string, lang: string = 'en') {
    const l = lang as any;
    const keyboard = new Keyboard()
        .text(t(l, 'menu_balance')).text(t(l, 'menu_topup')).row()
        .text(t(l, 'menu_history')).text(t(l, 'menu_settings'));

    if (role === 'merchant') {
        keyboard.row().text(t(l, 'menu_merchant'));
    }

    return keyboard.resized();
}

export function getMerchantMenu(lang: string = 'en') {
    const l = lang as any;
    return new Keyboard()
        .text(t(l, 'menu_balance')).row()
        .text(t(l, 'merchant_menu_invoice')).text(t(l, 'merchant_menu_report')).row()
        .text(t(l, 'merchant_menu_edit_name')).row()
        .text(t(l, 'switch_to_user'))
        .resized();
}

export function getInvoiceMenu(lang: string = 'en') {
    const l = lang as any;
    return new Keyboard()
        .text(t(l, 'invoice_create')).text(t(l, 'invoice_view')).row()
        .text(t(l, 'back_merchant'))
        .resized();
}

export function getInvoiceTypeMenu(lang: string = 'en') {
    const l = lang as any;
    return new Keyboard()
        .text(t(l, 'invoice_type_onetime')).text(t(l, 'invoice_type_reusable')).row()
        .text(t(l, 'back_merchant')) // Was back_main
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
