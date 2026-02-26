import mongoose from 'mongoose';

const bookSchema = new mongoose.Schema({
    title: { type: String, required: true, trim: true },
    pdfUrl: { type: String, required: true, trim: true },
    cloudinaryId: { type: String, required: true, trim: true },
    totalPages: { type: Number, default: 0, min: 0 },
    currentPage: { type: Number, default: 0, min: 0 },

    vocabulary: [{
        word: { type: String, trim: true, required: true },
        definition: { type: String, trim: true, required: true }
    }],

    notes: [{
        title: { type: String, trim: true, required: true },
        content: { type: String, trim: true, required: true },
        createdAt: { type: Date, default: Date.now }
    }],

    // Link to the user who uploaded the book
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
}, { timestamps: true });

// Virtual for progress calculation
bookSchema.virtual('progressPercentage').get(function() {
    if (this.totalPages === 0) return 0;
    return Math.round((this.currentPage / this.totalPages) * 100);
});

bookSchema.set('toJSON', { virtuals: true });

export const Book = mongoose.model('Book', bookSchema);
