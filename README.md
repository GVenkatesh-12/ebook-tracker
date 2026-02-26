# Ebook Tracker API

Backend API for uploading PDF ebooks, tracking reading progress, and saving vocabulary and notes per book.

## Features

- JWT-based authentication (`signup` / `login` / `change-password`)
- Auth-protected ebook APIs
- PDF upload to Cloudinary (`raw` resource)
- PDF page extraction (`totalPages`) using `pdf-parse-fork`
- Reading progress tracking (`currentPage` + computed `progressPercentage`)
- Vocabulary entries per book
- Notes per book (`title`, `content`)
- Book ownership enforcement (users can access only their own books)
- Upload validation:
  - PDF-only uploads
  - Maximum file size: `15 MB`

## Tech Stack

- Node.js + Express
- MongoDB + Mongoose
- JWT (`jsonwebtoken`)
- Password hashing (`bcryptjs`)
- File upload (`multer`)
- PDF parsing (`pdf-parse-fork`)
- Cloudinary

## Project Structure

```txt
ebook-tracker/
├── middleware/
│   └── auth.js
├── models/
│   ├── Book.js
│   └── User.js
├── scripts/
│   └── api-smoke-test.sh
├── uploads/
├── server.js
├── package.json
└── README.md
```

## Prerequisites

- Node.js 18+ recommended
- MongoDB instance (local or Atlas)
- Cloudinary account

## Environment Variables

Create `.env` in project root:

```env
PORT=3000
MONGO_URI=your_mongodb_connection_string
JWT_SECRET=your_strong_jwt_secret
CLOUD_NAME=your_cloudinary_cloud_name
CLOUD_API_KEY=your_cloudinary_api_key
CLOUD_API_SECRET=your_cloudinary_api_secret
```

The server validates required env vars on startup and exits if any are missing.

## Installation

```bash
npm install
```

## Run the API

```bash
node server.js
```

Expected startup logs:

- `Server live: connected to MongoDB.`
- `API running on port 3000`

## Authentication

Use Bearer token in protected routes:

```http
Authorization: Bearer <jwt_token>
```

The token is issued from `POST /auth/login`.

## API Base URL

Local default:

```txt
http://localhost:3000
```

---

## API Endpoints

### 1. Signup

- **POST** `/auth/signup`
- **Public**

Request body:

```json
{
  "email": "user@example.com",
  "password": "StrongPass123!"
}
```

Validation:

- `email` must be valid format
- `password` min length is 8
- duplicate email returns `409`

Success response (`201`):

```json
{
  "message": "User registered successfully!"
}
```

### 2. Login

- **POST** `/auth/login`
- **Public**

Request body:

```json
{
  "email": "user@example.com",
  "password": "StrongPass123!"
}
```

Success response (`200`):

```json
{
  "token": "<jwt_token>",
  "userId": "mongo_user_id"
}
```

### 3. Change Password

- **PATCH** `/auth/change-password`
- **Protected**

Request body:

```json
{
  "oldPassword": "StrongPass123!",
  "newPassword": "StrongPass456!"
}
```

Validation:

- `oldPassword` and `newPassword` are required
- `newPassword` min length is 8
- `newPassword` must be different from `oldPassword`
- old password must match current account password

Success response (`200`):

```json
{
  "message": "Password changed successfully."
}
```

### 4. Upload Book (PDF)

- **POST** `/upload-book`
- **Protected**
- `multipart/form-data`

Form fields:

- `pdf` (required): PDF file only, max `15 MB`
- `title` (optional): if omitted, original filename is used

Behavior:

- Reads uploaded PDF
- Extracts number of pages (`totalPages`)
- Uploads file to Cloudinary (`resource_type: raw`)
- Stores metadata in MongoDB

Success response (`201`) example:

```json
{
  "_id": "book_id",
  "title": "Smoke Test Book",
  "pdfUrl": "https://res.cloudinary.com/.../raw/upload/...",
  "cloudinaryId": "my_ebooks/....",
  "totalPages": 10,
  "currentPage": 0,
  "owner": "user_id",
  "vocabulary": [],
  "notes": [],
  "progressPercentage": 0
}
```

Upload errors:

- non-PDF file -> `400` `Only PDF files are allowed.`
- file size > 15 MB -> `400` `PDF file must be 15 MB or smaller.`

### 5. Get My Books

- **GET** `/books`
- **Protected**

Returns current user books sorted by newest first.

Success response (`200`): array of books.

### 6. Update Reading Progress

- **PATCH** `/books/:id/progress`
- **Protected**

Request body:

```json
{
  "page": 5
}
```

Validation:

- valid MongoDB book id required
- `page` must be a non-negative integer
- if `totalPages > 0`, `page` cannot exceed `totalPages`

Success response (`200`):

```json
{
  "page": 5,
  "percent": 50
}
```

### 7. Add Vocabulary

- **POST** `/books/:id/vocab`
- **Protected**

Request body:

```json
{
  "word": "ubiquitous",
  "definition": "present or found everywhere"
}
```

Validation:

- valid MongoDB book id required
- `word` required
- `definition` required

Success response (`200`): updated `vocabulary` array.

### 8. Edit Vocabulary

- **PATCH** `/books/:id/vocab/:vocabId`
- **Protected**

Request body (at least one field required):

```json
{
  "word": "pervasive",
  "definition": "spreading widely throughout an area or group"
}
```

Validation:

- valid `bookId` and `vocabId`
- at least one of `word` or `definition` provided and non-empty

Success response (`200`): updated vocab object.

### 9. Delete Vocabulary

- **DELETE** `/books/:id/vocab/:vocabId`
- **Protected**

Validation:

- valid `bookId` and `vocabId`

Success response (`200`):

```json
{
  "message": "Vocab deleted."
}
```

### 10. Add Note

- **POST** `/books/:id/notes`
- **Protected**

Request body:

```json
{
  "title": "Important point",
  "content": "This chapter explains the concept clearly."
}
```

Validation:

- valid MongoDB book id required
- `title` required
- `content` required

Success response (`201`) example:

```json
{
  "_id": "note_id",
  "title": "Important point",
  "content": "This chapter explains the concept clearly.",
  "createdAt": "2026-02-26T10:00:00.000Z"
}
```

### 11. Get Notes

- **GET** `/books/:id/notes`
- **Protected**

Success response (`200`): array of note objects.

### 12. Update Note

- **PATCH** `/books/:id/notes/:noteId`
- **Protected**

Request body (at least one field required):

```json
{
  "title": "Updated title",
  "content": "Updated content"
}
```

Validation:

- valid `bookId` and `noteId`
- at least one of `title` or `content` provided and non-empty

Success response (`200`): updated note object.

### 13. Delete Note

- **DELETE** `/books/:id/notes/:noteId`
- **Protected**

Validation:

- valid `bookId` and `noteId`

Success response (`200`):

```json
{
  "message": "Note deleted."
}
```

### 14. Delete Book

- **DELETE** `/books/:id`
- **Protected**

Behavior:

- verifies ownership
- deletes file from Cloudinary
- deletes DB record

Success response (`200`):

```json
{
  "message": "Book deleted."
}
```

---

## Error Handling

Common status codes:

- `200` Success
- `201` Created
- `400` Validation error / bad request
- `401` Unauthorized / invalid token
- `404` Resource not found
- `409` Conflict (duplicate signup email)
- `500` Internal server error

Typical error format:

```json
{
  "error": "Error message"
}
```

## Data Models

### User

- `email` (unique, lowercase, trimmed, validated format)
- `password` (hashed)
- `createdAt`, `updatedAt`

### Book

- `title` (required)
- `pdfUrl` (required)
- `cloudinaryId` (required)
- `totalPages` (default `0`, min `0`)
- `currentPage` (default `0`, min `0`)
- `owner` (User ObjectId)
- `vocabulary[]` with:
  - `word` (required)
  - `definition` (required)
- `notes[]` with:
  - `title` (required)
  - `content` (required)
  - `createdAt`
- virtual `progressPercentage`

## Smoke Test Script

The repo includes an end-to-end test script:

```bash
npm run smoke:api
```

Default PDF path used by the script:

```txt
./uploads/bonified_certificate.pdf
```

Override any variable:

```bash
BASE_URL=http://localhost:3000 \
EMAIL=test@example.com \
PASSWORD=TestPass123! \
PDF_PATH=./uploads/your.pdf \
npm run smoke:api
```

## Quick cURL Examples

Signup:

```bash
curl -X POST http://localhost:3000/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"StrongPass123!"}'
```

Login:

```bash
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"StrongPass123!"}'
```

Change password:

```bash
curl -X PATCH http://localhost:3000/auth/change-password \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"oldPassword":"StrongPass123!","newPassword":"StrongPass456!"}'
```

Upload PDF:

```bash
curl -X POST http://localhost:3000/upload-book \
  -H "Authorization: Bearer <token>" \
  -F "pdf=@./uploads/bonified_certificate.pdf;type=application/pdf" \
  -F "title=My Book"
```

Edit vocabulary:

```bash
curl -X PATCH http://localhost:3000/books/<bookId>/vocab/<vocabId> \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"word":"pervasive","definition":"spreading widely"}'
```

Delete vocabulary:

```bash
curl -X DELETE http://localhost:3000/books/<bookId>/vocab/<vocabId> \
  -H "Authorization: Bearer <token>"
```

Add note:

```bash
curl -X POST http://localhost:3000/books/<bookId>/notes \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"title":"Important point","content":"Useful summary from this page."}'
```

## Notes

- Temp uploaded files are removed after request handling.
- The API currently focuses on core functionality; rate limiting and formal automated tests can be added next for stronger production readiness.
