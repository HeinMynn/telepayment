import mongoose, { Schema, Document } from 'mongoose';

export interface ISubscriptionPlan extends Document {
    channelId: mongoose.Types.ObjectId;
    durationMonths: number; // 1, 3, 6, 12
    price: number;
    isActive: boolean;
}

const SubscriptionPlanSchema = new Schema({
    channelId: { type: Schema.Types.ObjectId, ref: 'MerchantChannel', required: true },
    durationMonths: { type: Number, required: true, enum: [1, 3, 6, 12] },
    price: { type: Number, required: true },
    isActive: { type: Boolean, default: true }
}, { timestamps: true });

export default mongoose.models.SubscriptionPlan || mongoose.model<ISubscriptionPlan>('SubscriptionPlan', SubscriptionPlanSchema);
