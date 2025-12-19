import mongoose, { Schema, Document } from 'mongoose';

export interface IPaymentMethod {
    provider: 'kpay' | 'wavepay';
    accountName: string;
    accountNumber: string;
}

export interface IUser extends Document {
    telegramId: number;
    balance: number;
    frozenBalance: number;
    role: 'user' | 'merchant' | 'admin';
    termsAccepted: boolean;
    termsAcceptedAt?: Date;
    isFrozen: boolean;
    language: string;
    username?: string;
    firstName?: string;
    lastName?: string;

    // Phase 2 Fields
    paymentMethods: IPaymentMethod[];
    interactionState: string;
    tempData?: any; // JSON storage for multi-step flows
    invoiceUsage: {
        oneTime: number;
        reusable: number;
        month: string;
    };
    // Referral
    referrer?: mongoose.Types.ObjectId;
    referralRewardClaimed?: boolean;
    // Favourites
    favouriteChannels?: mongoose.Types.ObjectId[];
}

const UserSchema: Schema = new Schema({
    telegramId: { type: Number, required: true, unique: true, index: true },
    balance: { type: Number, default: 0 },
    frozenBalance: { type: Number, default: 0 },
    role: { type: String, enum: ['user', 'merchant', 'admin'], default: 'user' },
    termsAccepted: { type: Boolean, default: false },
    termsAcceptedAt: { type: Date },
    isFrozen: { type: Boolean, default: false },
    language: { type: String, default: 'en' },
    username: { type: String },
    firstName: { type: String },
    lastName: { type: String },

    // Phase 2
    paymentMethods: [{
        provider: { type: String },
        accountName: { type: String },
        accountNumber: { type: String }
    }],
    interactionState: { type: String, default: 'idle' },
    tempData: { type: Schema.Types.Mixed },
    invoiceUsage: {
        oneTime: { type: Number, default: 0 },
        reusable: { type: Number, default: 0 },
        month: { type: String, default: '' }
    },
    // Referral
    referrer: { type: Schema.Types.ObjectId, ref: 'User' },
    referralRewardClaimed: { type: Boolean, default: false },
    // Favourites
    favouriteChannels: [{ type: Schema.Types.ObjectId, ref: 'MerchantChannel' }]
}, { timestamps: true });

export default mongoose.models.User || mongoose.model<IUser>('User', UserSchema);
