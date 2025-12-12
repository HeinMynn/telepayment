import mongoose, { Schema, Document } from 'mongoose';

export interface IInvoice extends Document {
    merchantId: mongoose.Types.ObjectId;
    type: 'one-time' | 'reusable';
    amount: number; // in cents
    status: 'active' | 'completed' | 'revoked' | 'expired';
    uniqueId: string; // The UUID used in the deep link
    usageCount: number;
    createdMonth: string; // YYYY-MM for limit tracking
}

const InvoiceSchema = new Schema({
    merchantId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: ['one-time', 'reusable'], required: true },
    amount: { type: Number, required: true },
    status: { type: String, enum: ['active', 'completed', 'revoked', 'expired'], default: 'active' },
    uniqueId: { type: String, required: true, unique: true },
    usageCount: { type: Number, default: 0 },
    createdMonth: { type: String, required: true },
}, { timestamps: true });

export default mongoose.models.Invoice || mongoose.model<IInvoice>('Invoice', InvoiceSchema);
