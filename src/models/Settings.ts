import mongoose, { Schema, Document } from 'mongoose';

export interface ISettings extends Document {
    key: string;
    value: any;
    updatedAt: Date;
}

const SettingsSchema = new Schema({
    key: { type: String, required: true, unique: true },
    value: { type: Schema.Types.Mixed, required: true }
}, { timestamps: true });

// Default popular pricing
export const DEFAULT_POPULAR_PRICING = {
    1: 50000,    // 1 month
    3: 120000,   // 3 months
    6: 200000,   // 6 months
    12: 350000   // 12 months
};

export default mongoose.models.Settings || mongoose.model<ISettings>('Settings', SettingsSchema);
