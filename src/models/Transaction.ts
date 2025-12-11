import mongoose, { Schema, Document } from 'mongoose';

export interface ITransaction extends Document {
    fromUser: mongoose.Types.ObjectId;
    toUser: mongoose.Types.ObjectId;
    amount: number;
    status: 'pending' | 'completed' | 'failed' | 'cancelled';
    // Snapshots of the Sender's balance for audit trails
    snapshotBalanceBefore?: number;
    snapshotBalanceAfter?: number;
}

const TransactionSchema = new Schema({
    fromUser: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    toUser: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    amount: { type: Number, required: true },
    status: { type: String, enum: ['pending', 'completed', 'failed', 'cancelled'], default: 'pending' },
    snapshotBalanceBefore: { type: Number },
    snapshotBalanceAfter: { type: Number },
}, { timestamps: true });

export default mongoose.models.Transaction || mongoose.model<ITransaction>('Transaction', TransactionSchema);
