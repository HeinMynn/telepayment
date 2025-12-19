import mongoose, { Schema, Document } from 'mongoose';

export interface IMerchantChannel extends Document {
    merchantId: mongoose.Types.ObjectId;
    channelId: number; // Telegram Chat ID
    title: string;
    username?: string;
    description?: string;
    isActive: boolean;
    isPopular: boolean;
    popularExpiresAt?: Date;
    isCategoryFeatured: boolean;
    categoryFeaturedExpiresAt?: Date;
    category: 'entertainment' | 'education' | 'business' | 'gaming' | 'lifestyle' | 'other';
}

const MerchantChannelSchema = new Schema({
    merchantId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    channelId: { type: Number, required: true },
    title: { type: String, required: true },
    username: { type: String },
    description: { type: String, maxlength: 200 },
    isActive: { type: Boolean, default: true },
    isPopular: { type: Boolean, default: false },
    popularExpiresAt: { type: Date },
    isCategoryFeatured: { type: Boolean, default: false },
    categoryFeaturedExpiresAt: { type: Date },
    category: { type: String, enum: ['entertainment', 'education', 'business', 'gaming', 'lifestyle', 'other'], default: 'other' }
}, { timestamps: true });

// Composite index to ensure a merchant doesn't add same channel twice
MerchantChannelSchema.index({ merchantId: 1, channelId: 1 }, { unique: true });
MerchantChannelSchema.index({ merchantId: 1, isActive: 1 }); // Optimize "Your Channels" list
MerchantChannelSchema.index({ isPopular: 1, popularExpiresAt: 1 }); // Optimize Popular query
MerchantChannelSchema.index({ category: 1, isCategoryFeatured: 1, categoryFeaturedExpiresAt: 1 }); // Optimize category featured query

export default mongoose.models.MerchantChannel || mongoose.model<IMerchantChannel>('MerchantChannel', MerchantChannelSchema);

