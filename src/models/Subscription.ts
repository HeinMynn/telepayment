import mongoose, { Schema, Document } from 'mongoose';

export interface ISubscription extends Document {
    userId: mongoose.Types.ObjectId;
    channelId: mongoose.Types.ObjectId;
    planId: mongoose.Types.ObjectId;
    startDate: Date;
    endDate: Date;
    status: 'active' | 'expired' | 'cancelled';
    paymentTxId: mongoose.Types.ObjectId;
    notifiedWarning?: boolean;
    notifiedFinal?: boolean;
    notifiedExpired?: boolean;
}

const SubscriptionSchema = new Schema({
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    channelId: { type: Schema.Types.ObjectId, ref: 'MerchantChannel', required: true },
    planId: { type: Schema.Types.ObjectId, ref: 'SubscriptionPlan', required: true },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    status: { type: String, enum: ['active', 'expired', 'cancelled'], default: 'active' },
    paymentTxId: { type: Schema.Types.ObjectId, ref: 'Transaction' },
    notifiedWarning: { type: Boolean, default: false },
    notifiedFinal: { type: Boolean, default: false },
    notifiedExpired: { type: Boolean, default: false }
}, { timestamps: true });

SubscriptionSchema.index({ userId: 1, endDate: -1 });

export default mongoose.models.Subscription || mongoose.model<ISubscription>('Subscription', SubscriptionSchema);
