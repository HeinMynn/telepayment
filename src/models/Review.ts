import mongoose, { Schema, Document } from 'mongoose';

export interface IReview extends Document {
    userId: mongoose.Types.ObjectId;
    channelId: mongoose.Types.ObjectId;
    rating: number; // 1-5 stars
    comment?: string;
    createdAt: Date;
    updatedAt: Date;
}

const ReviewSchema = new Schema({
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    channelId: { type: Schema.Types.ObjectId, ref: 'MerchantChannel', required: true },
    rating: { type: Number, required: true, min: 1, max: 5 },
    comment: { type: String, maxlength: 500 }
}, { timestamps: true });

// One review per user per channel
ReviewSchema.index({ userId: 1, channelId: 1 }, { unique: true });
// For fetching reviews by channel
ReviewSchema.index({ channelId: 1, createdAt: -1 });

export default mongoose.models.Review || mongoose.model<IReview>('Review', ReviewSchema);
