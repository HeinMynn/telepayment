import AuditLog from '@/models/AuditLog';
import mongoose from 'mongoose';

export async function logAudit(
    userId: mongoose.Types.ObjectId | string,
    action: string,
    targetType: 'plan' | 'channel' | 'account' | 'invoice',
    targetId: string,
    details: Record<string, any> = {}
) {
    try {
        await AuditLog.create({
            userId,
            action,
            targetType,
            targetId,
            details
        });
    } catch (e) {
        console.error('[AuditLog] Failed to log:', e);
    }
}

// Action constants
export const AUDIT_ACTIONS = {
    PLAN_CREATED: 'plan_created',
    PLAN_PRICE_CHANGED: 'plan_price_changed',
    PLAN_TOGGLED: 'plan_toggled',
    CHANNEL_ADDED: 'channel_added',
    CHANNEL_CATEGORY_CHANGED: 'channel_category_changed',
    ACCOUNT_ADDED: 'account_added',
    ACCOUNT_REMOVED: 'account_removed'
};
