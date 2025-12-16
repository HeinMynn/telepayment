import mongoose, { Schema, Document } from 'mongoose';

export interface IAuditLog extends Document {
    userId: mongoose.Types.ObjectId;
    action: string;
    targetType: 'plan' | 'channel' | 'account' | 'invoice';
    targetId: string;
    details: Record<string, any>;
    createdAt: Date;
}

const AuditLogSchema = new Schema({
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    action: { type: String, required: true },
    targetType: { type: String, enum: ['plan', 'channel', 'account', 'invoice'], required: true },
    targetId: { type: String, required: true },
    details: { type: Schema.Types.Mixed, default: {} }
}, { timestamps: true });

// Index for efficient queries
AuditLogSchema.index({ userId: 1, createdAt: -1 });

export default mongoose.models.AuditLog || mongoose.model<IAuditLog>('AuditLog', AuditLogSchema);
