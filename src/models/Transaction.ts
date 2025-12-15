import mongoose, { Schema, Document } from 'mongoose';

export interface ITransaction extends Document {
    fromUser?: mongoose.Types.ObjectId; // Optional for Topup (System -> User)
    toUser?: mongoose.Types.ObjectId;   // Optional for Withdraw (User -> System)
    amount: number;
    status: 'pending' | 'completed' | 'failed' | 'cancelled' | 'rejected' | 'approved';

    // Audit
    snapshotBalanceBefore?: number;
    snapshotBalanceAfter?: number;

    // Phase 2
    invoiceId?: mongoose.Types.ObjectId;
    type: 'payment' | 'topup' | 'withdraw' | 'subscription';
    proofImageId?: string;
    rejectionReason?: string;
    adminProcessedBy?: mongoose.Types.ObjectId;
}

const TransactionSchema = new Schema({
    fromUser: { type: Schema.Types.ObjectId, ref: 'User' },
    toUser: { type: Schema.Types.ObjectId, ref: 'User' },
    amount: { type: Number, required: true },
    status: { type: String, enum: ['pending', 'completed', 'failed', 'cancelled', 'rejected', 'approved'], default: 'pending' },
    snapshotBalanceBefore: { type: Number },
    snapshotBalanceAfter: { type: Number },

    // Phase 2
    invoiceId: { type: Schema.Types.ObjectId, ref: 'Invoice' },
    type: { type: String, enum: ['payment', 'topup', 'withdraw', 'subscription'], default: 'payment' },
    proofImageId: { type: String },
    rejectionReason: { type: String },
    adminProcessedBy: { type: Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

export default mongoose.models.Transaction || mongoose.model<ITransaction>('Transaction', TransactionSchema);
