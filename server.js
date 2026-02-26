import express from 'express';
import mongoose from 'mongoose';
import multer from 'multer';
import { promises as fs } from 'fs';
import pdf from 'pdf-parse-fork';
import { v2 as cloudinary } from 'cloudinary';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import 'dotenv/config';

import { Book } from './models/Book.js';
import { User } from './models/User.js';
import { auth } from './middleware/auth.js';

const app = express();
app.use(express.json({ limit: '1mb' }));
const PORT = process.env.PORT || 3000;
const MAX_PDF_SIZE_BYTES = 15 * 1024 * 1024;
const REQUIRED_ENV_VARS = [
    'MONGO_URI',
    'CLOUD_NAME',
    'CLOUD_API_KEY',
    'CLOUD_API_SECRET',
    'JWT_SECRET'
];

function ensureRequiredEnvVars() {
    const missing = REQUIRED_ENV_VARS.filter((key) => !process.env[key]);
    if (missing.length > 0) {
        throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
    }
}

function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function parsePage(value) {
    const parsed = Number(value);
    return Number.isInteger(parsed) ? parsed : null;
}

function parseNonEmptyString(value) {
    if (typeof value !== 'string') return null;
    const parsed = value.trim();
    return parsed ? parsed : null;
}

cloudinary.config({
    cloud_name: process.env.CLOUD_NAME,
    api_key: process.env.CLOUD_API_KEY,
    api_secret: process.env.CLOUD_API_SECRET
});

const upload = multer({
    dest: 'uploads/',
    limits: { fileSize: MAX_PDF_SIZE_BYTES },
    fileFilter: (req, file, cb) => {
        const hasPdfMime = file.mimetype === 'application/pdf';
        const hasPdfExtension = /\.pdf$/i.test(file.originalname || '');
        if (!hasPdfMime && !hasPdfExtension) {
            return cb(new Error('Only PDF files are allowed.'));
        }
        cb(null, true);
    }
});

// --- AUTH ROUTES ---

// SIGNUP
app.post('/auth/signup', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (typeof email !== 'string' || typeof password !== 'string') {
            return res.status(400).json({ error: 'Email and password are required.' });
        }

        const normalizedEmail = email.trim().toLowerCase();
        if (!isValidEmail(normalizedEmail)) {
            return res.status(400).json({ error: 'Invalid email format.' });
        }

        if (password.length < 8) {
            return res.status(400).json({ error: 'Password must be at least 8 characters long.' });
        }

        const existingUser = await User.findOne({ email: normalizedEmail });
        if (existingUser) {
            return res.status(409).json({ error: 'Email already in use.' });
        }

        const hashedPassword = await bcrypt.hash(password, 12);
        const user = new User({ email: normalizedEmail, password: hashedPassword });
        await user.save();
        res.status(201).json({ message: 'User registered successfully!' });
    } catch (err) {
        res.status(500).json({ error: 'Signup failed.' });
    }
});

// LOGIN
app.post('/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (typeof email !== 'string' || typeof password !== 'string') {
            return res.status(400).json({ error: 'Email and password are required.' });
        }

        const normalizedEmail = email.trim().toLowerCase();
        const user = await User.findOne({ email: normalizedEmail });
        if (!user || !(await bcrypt.compare(password, user.password))) {
            return res.status(400).json({ error: 'Invalid login credentials.' });
        }
        const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '7d' });
        res.json({ token, userId: user._id });
    } catch (err) {
        res.status(500).json({ error: 'Login failed.' });
    }
});

// CHANGE PASSWORD (Authenticated)
app.patch('/auth/change-password', auth, async (req, res) => {
    try {
        const oldPassword = parseNonEmptyString(req.body.oldPassword);
        const newPassword = parseNonEmptyString(req.body.newPassword);

        if (!oldPassword || !newPassword) {
            return res.status(400).json({ error: 'oldPassword and newPassword are required.' });
        }

        if (newPassword.length < 8) {
            return res.status(400).json({ error: 'New password must be at least 8 characters long.' });
        }

        if (oldPassword === newPassword) {
            return res.status(400).json({ error: 'New password must be different from old password.' });
        }

        const user = await User.findById(req.user.id);
        if (!user) {
            return res.status(404).json({ error: 'User not found.' });
        }

        const isOldPasswordValid = await bcrypt.compare(oldPassword, user.password);
        if (!isOldPasswordValid) {
            return res.status(400).json({ error: 'Old password is incorrect.' });
        }

        user.password = await bcrypt.hash(newPassword, 12);
        await user.save();

        res.json({ message: 'Password changed successfully.' });
    } catch (err) {
        res.status(500).json({ error: 'Could not change password.' });
    }
});

// --- PROTECTED BOOK ROUTES ---

// 1. UPLOAD (Authenticated)
app.post('/upload-book', auth, upload.single('pdf'), async (req, res) => {
    let filePath;
    try {
        if (!req.file) return res.status(400).json({ error: 'PDF required.' });

        filePath = req.file.path;
        const dataBuffer = await fs.readFile(filePath);
        const pdfData = await pdf(dataBuffer);
        const totalPages = Number.isInteger(pdfData.numpages) ? Math.max(pdfData.numpages, 0) : 0;

        const result = await cloudinary.uploader.upload(filePath, {
            resource_type: 'raw',
            folder: 'my_ebooks'
        });

        const title =
            typeof req.body.title === 'string' && req.body.title.trim()
                ? req.body.title.trim()
                : req.file.originalname;

        const newBook = new Book({
            title,
            pdfUrl: result.secure_url,
            cloudinaryId: result.public_id,
            totalPages,
            owner: req.user.id
        });

        await newBook.save();
        res.status(201).json(newBook);
    } catch (err) {
        res.status(500).json({ error: 'Upload failed.' });
    } finally {
        if (filePath) {
            await fs.unlink(filePath).catch(() => undefined);
        }
    }
});

// 2. GET MY BOOKS
app.get('/books', auth, async (req, res) => {
    try {
        const books = await Book.find({ owner: req.user.id }).sort({ createdAt: -1 });
        res.json(books);
    } catch (err) {
        res.status(500).json({ error: 'Could not fetch books.' });
    }
});

// 3. UPDATE PROGRESS
app.patch('/books/:id/progress', auth, async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ error: 'Invalid book ID.' });
        }

        const page = parsePage(req.body.page);
        if (page === null || page < 0) {
            return res.status(400).json({ error: 'Page must be a non-negative integer.' });
        }

        const book = await Book.findOne({ _id: req.params.id, owner: req.user.id });
        if (!book) return res.status(404).json({ error: 'Book not found.' });

        if (book.totalPages > 0 && page > book.totalPages) {
            return res.status(400).json({ error: `Page cannot exceed total pages (${book.totalPages}).` });
        }

        book.currentPage = page;
        await book.save();
        res.json({ page: book.currentPage, percent: book.progressPercentage });
    } catch (err) {
        res.status(500).json({ error: 'Update failed.' });
    }
});

// 4. ADD VOCAB
app.post('/books/:id/vocab', auth, async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ error: 'Invalid book ID.' });
        }

        const { word, definition } = req.body;
        if (typeof word !== 'string' || !word.trim()) {
            return res.status(400).json({ error: 'word is required.' });
        }
        if (typeof definition !== 'string' || !definition.trim()) {
            return res.status(400).json({ error: 'definition is required.' });
        }

        const book = await Book.findOne({ _id: req.params.id, owner: req.user.id });
        if (!book) return res.status(404).json({ error: 'Book not found.' });
        book.vocabulary.push({ word: word.trim(), definition: definition.trim() });
        await book.save();
        res.json(book.vocabulary);
    } catch (err) {
        res.status(500).json({ error: 'Could not add vocab.' });
    }
});

// 5. UPDATE VOCAB
app.patch('/books/:id/vocab/:vocabId', auth, async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ error: 'Invalid book ID.' });
        }
        if (!mongoose.Types.ObjectId.isValid(req.params.vocabId)) {
            return res.status(400).json({ error: 'Invalid vocab ID.' });
        }

        const word = parseNonEmptyString(req.body.word);
        const definition = parseNonEmptyString(req.body.definition);
        if (!word && !definition) {
            return res.status(400).json({ error: 'At least one of word or definition is required.' });
        }

        const book = await Book.findOne({ _id: req.params.id, owner: req.user.id });
        if (!book) return res.status(404).json({ error: 'Book not found.' });

        const vocab = book.vocabulary.id(req.params.vocabId);
        if (!vocab) {
            return res.status(404).json({ error: 'Vocab not found.' });
        }

        if (word) vocab.word = word;
        if (definition) vocab.definition = definition;
        await book.save();
        res.json(vocab);
    } catch (err) {
        res.status(500).json({ error: 'Could not update vocab.' });
    }
});

// 6. DELETE VOCAB
app.delete('/books/:id/vocab/:vocabId', auth, async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ error: 'Invalid book ID.' });
        }
        if (!mongoose.Types.ObjectId.isValid(req.params.vocabId)) {
            return res.status(400).json({ error: 'Invalid vocab ID.' });
        }

        const book = await Book.findOne({ _id: req.params.id, owner: req.user.id });
        if (!book) return res.status(404).json({ error: 'Book not found.' });

        const vocab = book.vocabulary.id(req.params.vocabId);
        if (!vocab) {
            return res.status(404).json({ error: 'Vocab not found.' });
        }

        vocab.deleteOne();
        await book.save();
        res.json({ message: 'Vocab deleted.' });
    } catch (err) {
        res.status(500).json({ error: 'Could not delete vocab.' });
    }
});

// 7. ADD NOTE
app.post('/books/:id/notes', auth, async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ error: 'Invalid book ID.' });
        }

        const title = parseNonEmptyString(req.body.title);
        const content = parseNonEmptyString(req.body.content);
        if (!title) {
            return res.status(400).json({ error: 'title is required.' });
        }
        if (!content) {
            return res.status(400).json({ error: 'content is required.' });
        }

        const book = await Book.findOne({ _id: req.params.id, owner: req.user.id });
        if (!book) return res.status(404).json({ error: 'Book not found.' });

        book.notes.push({ title, content });
        await book.save();
        res.status(201).json(book.notes[book.notes.length - 1]);
    } catch (err) {
        res.status(500).json({ error: 'Could not add note.' });
    }
});

// 8. GET NOTES
app.get('/books/:id/notes', auth, async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ error: 'Invalid book ID.' });
        }

        const book = await Book.findOne({ _id: req.params.id, owner: req.user.id }).select('notes');
        if (!book) return res.status(404).json({ error: 'Book not found.' });

        res.json(book.notes);
    } catch (err) {
        res.status(500).json({ error: 'Could not fetch notes.' });
    }
});

// 9. UPDATE NOTE
app.patch('/books/:id/notes/:noteId', auth, async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ error: 'Invalid book ID.' });
        }
        if (!mongoose.Types.ObjectId.isValid(req.params.noteId)) {
            return res.status(400).json({ error: 'Invalid note ID.' });
        }

        const title = parseNonEmptyString(req.body.title);
        const content = parseNonEmptyString(req.body.content);
        if (!title && !content) {
            return res.status(400).json({ error: 'At least one of title or content is required.' });
        }

        const book = await Book.findOne({ _id: req.params.id, owner: req.user.id });
        if (!book) return res.status(404).json({ error: 'Book not found.' });

        const note = book.notes.id(req.params.noteId);
        if (!note) {
            return res.status(404).json({ error: 'Note not found.' });
        }

        if (title) note.title = title;
        if (content) note.content = content;
        await book.save();
        res.json(note);
    } catch (err) {
        res.status(500).json({ error: 'Could not update note.' });
    }
});

// 10. DELETE NOTE
app.delete('/books/:id/notes/:noteId', auth, async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ error: 'Invalid book ID.' });
        }
        if (!mongoose.Types.ObjectId.isValid(req.params.noteId)) {
            return res.status(400).json({ error: 'Invalid note ID.' });
        }

        const book = await Book.findOne({ _id: req.params.id, owner: req.user.id });
        if (!book) return res.status(404).json({ error: 'Book not found.' });

        const note = book.notes.id(req.params.noteId);
        if (!note) {
            return res.status(404).json({ error: 'Note not found.' });
        }

        note.deleteOne();
        await book.save();
        res.json({ message: 'Note deleted.' });
    } catch (err) {
        res.status(500).json({ error: 'Could not delete note.' });
    }
});

// 11. DELETE BOOK
app.delete('/books/:id', auth, async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(400).json({ error: 'Invalid book ID.' });
        }

        const book = await Book.findOne({ _id: req.params.id, owner: req.user.id });
        if (!book) return res.status(404).json({ error: 'Unauthorized or not found.' });

        await cloudinary.uploader.destroy(book.cloudinaryId, { resource_type: 'raw' });
        await Book.findByIdAndDelete(req.params.id);
        res.json({ message: 'Book deleted.' });
    } catch (err) {
        res.status(500).json({ error: 'Delete failed.' });
    }
});

app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'PDF file must be 15 MB or smaller.' });
    }

    if (err?.message === 'Only PDF files are allowed.') {
        return res.status(400).json({ error: err.message });
    }

    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error.' });
});

async function startServer() {
    ensureRequiredEnvVars();
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Server live: connected to MongoDB.');
    app.listen(PORT, () => console.log(`API running on port ${PORT}`));
}

startServer().catch((err) => {
    console.error('Startup failed:', err.message);
    process.exit(1);
});
