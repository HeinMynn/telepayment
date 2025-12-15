import mongoose, { Schema, Document } from 'mongoose';

export interface IMerchantChannel extends Document {
    merchantId: mongoose.Types.ObjectId;
    channelId: number; // Telegram Chat ID
    title: string;
    username?: string;
    isActive: boolean;
}

const MerchantChannelSchema = new Schema({
    merchantId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    channelId: { type: Number, required: true },
    title: { type: String, required: true },
    username: { type: String },
    isActive: { type: Boolean, default: true }
}, { timestamps: true });

// Composite index to ensure a merchant doesn't add same channel twice
MerchantChannelSchema.index({ merchantId: 1, channelId: 1 }, { unique: true });

export default mongoose.models.MerchantChannel || mongoose.model<IMerchantChannel>('MerchantChannel', MerchantChannelSchema);
