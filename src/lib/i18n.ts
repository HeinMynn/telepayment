import { en } from '@/locales/en';
import { my } from '@/locales/my';

export type Language = 'en' | 'my';
export type TranslationKey = keyof typeof en;

const translations = { en, my };

export function t(lang: Language, key: TranslationKey, params?: Record<string, string | number>): string {
    // Fallback to English if translation missing or key not found in target lang
    let text = (translations[lang] as any)?.[key] || (translations['en'] as any)?.[key] || key;

    if (params) {
        Object.entries(params).forEach(([k, v]) => {
            text = text.replace(`\${${k}}`, String(v));
        });
    }
    return text;
}

export function isValidLanguage(lang: string): lang is Language {
    return ['en', 'my'].includes(lang);
}
