import express from 'express';
import mongoose from 'mongoose';
import multer from 'multer';
import cors from 'cors';
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
const corsOrigins = (process.env.CORS_ORIGIN || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
const corsOptions = corsOrigins.length > 0 ? { origin: corsOrigins } : {};

app.use(cors(corsOptions));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ limit: '15mb', extended: true }));
const PORT = process.env.PORT || 3000;
const MAX_PDF_SIZE_BYTES = 15 * 1024 * 1024;
const REQUIRED_ENV_VARS = [
    'MONGO_URI',
    'CLOUD_NAME',
    'CLOUD_API_KEY',
    'CLOUD_API_SECRET',
    'JWT_SECRET',
    'OPENROUTER_API_KEY'
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

// 12. TEXT-TO-SPEECH (OpenRouter / Fish Audio streaming proxy)
const OPENROUTER_API_URL = process.env.OPENROUTER_API_URL || 'https://openrouter.ai/api/v1';
const OPENROUTER_TTS_MODEL = process.env.OPENROUTER_TTS_MODEL || 'fish-audio/s2.1-pro-free:free';
const OPENROUTER_TTS_VOICE = process.env.OPENROUTER_TTS_VOICE || 'alloy';
// Fish Audio's pcm output defaults to 44.1 kHz (per its API docs); labeling
// it 24000 made the client play ~0.54x speed — a deep, alien-sounding voice.
const OPENROUTER_TTS_SAMPLE_RATE = Number(process.env.OPENROUTER_TTS_SAMPLE_RATE) || 44100;
const OPENROUTER_TTS_MAX_CHARS = 5000;
const OPENROUTER_TTS_MAX_RETRIES = 2;
const TTS_RELAY_CHUNK_BYTES = 48 * 1024;

function isRetryableTtsError(err) {
    const status = err?.status ?? err?.code;
    if (typeof status === 'number') return status === 429 || status >= 500;
    return /INTERNAL|UNAVAILABLE|ECONNRESET|fetch failed/i.test(String(err?.message ?? ''));
}

app.post('/tts/stream', auth, async (req, res) => {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
        return res.status(503).json({ error: 'TTS is not configured. Set OPENROUTER_API_KEY on the server.' });
    }

    const text = parseNonEmptyString(req.body?.text);
    if (!text) {
        return res.status(400).json({ error: 'Text is required.' });
    }
    // PDF text layers contain a line break per visual line wrap. Collapse
    // whitespace runs so the TTS model does not pause at every line end as if
    // it were a sentence or paragraph boundary (periods are preserved).
    const normalized = text.replace(/\s+/g, ' ');
    if (normalized.length > OPENROUTER_TTS_MAX_CHARS) {
        return res.status(400).json({ error: `Text must be ${OPENROUTER_TTS_MAX_CHARS} characters or fewer.` });
    }

    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('X-Accel-Buffering', 'no');

    const abortController = new AbortController();
    let clientGone = false;
    // `req` 'close' fires once the request body is consumed; only `res` 'close'
    // with an unfinished response indicates the client actually disconnected.
    res.on('close', () => {
        if (!res.writableEnded) {
            clientGone = true;
            abortController.abort();
        }
    });

    let lastError = null;
    let wroteAudio = false;

    for (let attempt = 0; attempt <= OPENROUTER_TTS_MAX_RETRIES; attempt++) {
        if (clientGone) return;
        try {
            const upstream = await fetch(`${OPENROUTER_API_URL}/audio/speech`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    model: OPENROUTER_TTS_MODEL,
                    input: normalized,
                    voice: OPENROUTER_TTS_VOICE,
                    response_format: 'pcm',
                }),
                signal: abortController.signal,
            });

            if (!upstream.ok) {
                const detail = await upstream.text().catch(() => '');
                const err = new Error(`OpenRouter error (${upstream.status}): ${detail.slice(0, 300) || upstream.statusText}`);
                err.status = upstream.status;
                throw err;
            }
            if (!upstream.body) {
                throw new Error('OpenRouter returned no response body.');
            }

            const reader = upstream.body.getReader();
            let pendingBytes = new Uint8Array(0);
            let totalBytes = 0;

            const relay = (bytes) => {
                if (!wroteAudio) {
                    wroteAudio = true;
                    console.log(
                        `[tts] OpenRouter model=${OPENROUTER_TTS_MODEL} voice=${OPENROUTER_TTS_VOICE} pcm rate=${OPENROUTER_TTS_SAMPLE_RATE} streaming`,
                    );
                }
                res.write(
                    JSON.stringify({
                        type: 'audio',
                        data: Buffer.from(bytes).toString('base64'),
                        mimeType: 'audio/l16',
                        sampleRate: OPENROUTER_TTS_SAMPLE_RATE,
                        channels: 1,
                    }) + '\n',
                );
            };

            for (;;) {
                if (clientGone) return;
                const { done, value } = await reader.read();
                if (done) break;
                if (!value || value.length === 0) continue;
                totalBytes += value.length;

                // Slice the byte stream into fixed-size PCM chunks for relay.
                if (pendingBytes.length === 0 && value.length >= TTS_RELAY_CHUNK_BYTES) {
                    let offset = 0;
                    while (value.length - offset >= TTS_RELAY_CHUNK_BYTES) {
                        relay(value.slice(offset, offset + TTS_RELAY_CHUNK_BYTES));
                        offset += TTS_RELAY_CHUNK_BYTES;
                    }
                    if (offset < value.length) pendingBytes = value.slice(offset);
                } else {
                    const combined = new Uint8Array(pendingBytes.length + value.length);
                    combined.set(pendingBytes);
                    combined.set(value, pendingBytes.length);
                    pendingBytes = combined;
                    while (pendingBytes.length >= TTS_RELAY_CHUNK_BYTES) {
                        relay(pendingBytes.slice(0, TTS_RELAY_CHUNK_BYTES));
                        pendingBytes = pendingBytes.slice(TTS_RELAY_CHUNK_BYTES);
                    }
                }
            }

            if (pendingBytes.length > 0) relay(pendingBytes);

            if (!wroteAudio) {
                console.error('[tts] upstream returned an empty audio stream');
            }
            res.write(JSON.stringify({ type: 'done' }) + '\n');
            res.end();
            return;
        } catch (err) {
            lastError = err;
            console.error('TTS upstream error (attempt', attempt + 1, 'of', OPENROUTER_TTS_MAX_RETRIES + 1, '):', err.message);
            if (wroteAudio || !isRetryableTtsError(err) || attempt >= OPENROUTER_TTS_MAX_RETRIES) break;
            await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
        }
    }

    if (clientGone) return;
    if (!wroteAudio) {
        return res.status(502).json({ error: `TTS error: ${lastError?.message || 'Unknown error'}` });
    }
    res.write(JSON.stringify({ type: 'error', message: `TTS error: ${lastError?.message || 'Unknown error'}` }) + '\n');
    res.end();
});

app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: `PDF file must be ${MAX_PDF_SIZE_BYTES / 1024 / 1024}MB or smaller.` });
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
