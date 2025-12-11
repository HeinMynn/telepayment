import mongoose, { Schema, Document } from 'mongoose';

export interface IMerchantProfile extends Document {
    userId: mongoose.Types.ObjectId;
    businessName: string;
    withdrawalMethod: string;
    agreedToMerchantRules: boolean;
}

const MerchantProfileSchema = new Schema({
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    businessName: { type: String, required: true },
    withdrawalMethod: { type: String, required: true },
    agreedToMerchantRules: { type: Boolean, default: false },
}, { timestamps: true });

export default mongoose.models.MerchantProfile || mongoose.model<IMerchantProfile>('MerchantProfile', MerchantProfileSchema);
