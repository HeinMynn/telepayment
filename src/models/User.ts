import mongoose, { Schema, Document } from 'mongoose';

export interface IUser extends Document {
    telegramId: number;
    balance: number; // in cents
    role: 'user' | 'merchant' | 'admin';
    termsAccepted: boolean;
    termsAcceptedAt?: Date;
    isFrozen: boolean;
    language: string;
}

const UserSchema: Schema = new Schema({
    telegramId: { type: Number, required: true, unique: true, index: true },
    balance: { type: Number, default: 0 },
    role: { type: String, enum: ['user', 'merchant', 'admin'], default: 'user' },
    termsAccepted: { type: Boolean, default: false },
    termsAcceptedAt: { type: Date },
    isFrozen: { type: Boolean, default: false },
    language: { type: String, default: 'en' },
}, { timestamps: true });

export default mongoose.models.User || mongoose.model<IUser>('User', UserSchema);
