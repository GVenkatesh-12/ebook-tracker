#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"
EMAIL="${EMAIL:-smoke.$(date +%s)@example.com}"
PASSWORD="${PASSWORD:-TestPass123!}"
PDF_PATH="${PDF_PATH:-./uploads/file_name.pdf}"

if [[ ! -f "${PDF_PATH}" ]]; then
  echo "Error: PDF file not found at ${PDF_PATH}"
  echo "Tip: set PDF_PATH explicitly, e.g. PDF_PATH=./uploads/your.pdf npm run smoke:api"
  exit 1
fi

json_get() {
  local key="$1"
  node -e "const fs=require('fs');const d=JSON.parse(fs.readFileSync(0,'utf8'));console.log(d['${key}'] ?? '')"
}

echo "1) Signup: ${EMAIL}"
SIGNUP_STATUS="$(curl -s -o /tmp/signup.json -w "%{http_code}" \
  -X POST "${BASE_URL}/auth/signup" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"${EMAIL}\",\"password\":\"${PASSWORD}\"}")"
echo "   status=${SIGNUP_STATUS}"
cat /tmp/signup.json
echo

echo "2) Login"
LOGIN_STATUS="$(curl -s -o /tmp/login.json -w "%{http_code}" \
  -X POST "${BASE_URL}/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"${EMAIL}\",\"password\":\"${PASSWORD}\"}")"
echo "   status=${LOGIN_STATUS}"
cat /tmp/login.json
echo

TOKEN="$(cat /tmp/login.json | json_get token)"
if [[ -z "${TOKEN}" ]]; then
  echo "Error: login did not return token."
  exit 1
fi

echo "3) Upload PDF (${PDF_PATH})"
UPLOAD_STATUS="$(curl -s -o /tmp/upload.json -w "%{http_code}" \
  -X POST "${BASE_URL}/upload-book" \
  -H "Authorization: Bearer ${TOKEN}" \
  -F "pdf=@${PDF_PATH};type=application/pdf" \
  -F "title=Smoke Test Book")"
echo "   status=${UPLOAD_STATUS}"
cat /tmp/upload.json
echo

BOOK_ID="$(cat /tmp/upload.json | json_get _id)"
TOTAL_PAGES="$(cat /tmp/upload.json | json_get totalPages)"
if [[ -z "${BOOK_ID}" ]]; then
  echo "Error: upload did not return book _id."
  exit 1
fi
echo "   bookId=${BOOK_ID}, totalPages=${TOTAL_PAGES}"

echo "4) Get books"
BOOKS_STATUS="$(curl -s -o /tmp/books.json -w "%{http_code}" \
  -X GET "${BASE_URL}/books" \
  -H "Authorization: Bearer ${TOKEN}")"
echo "   status=${BOOKS_STATUS}"
cat /tmp/books.json
echo

PAGE_TO_SET=1
if [[ -n "${TOTAL_PAGES}" ]] && [[ "${TOTAL_PAGES}" =~ ^[0-9]+$ ]] && [[ "${TOTAL_PAGES}" -gt 0 ]]; then
  PAGE_TO_SET="${TOTAL_PAGES}"
fi

echo "5) Update progress (page=${PAGE_TO_SET})"
PROGRESS_STATUS="$(curl -s -o /tmp/progress.json -w "%{http_code}" \
  -X PATCH "${BASE_URL}/books/${BOOK_ID}/progress" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"page\":${PAGE_TO_SET}}")"
echo "   status=${PROGRESS_STATUS}"
cat /tmp/progress.json
echo

echo "6) Add vocab"
VOCAB_STATUS="$(curl -s -o /tmp/vocab.json -w "%{http_code}" \
  -X POST "${BASE_URL}/books/${BOOK_ID}/vocab" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"word":"ubiquitous","definition":"present or found everywhere"}')"
echo "   status=${VOCAB_STATUS}"
cat /tmp/vocab.json
echo

echo "7) Add note"
ADD_NOTE_STATUS="$(curl -s -o /tmp/add_note.json -w "%{http_code}" \
  -X POST "${BASE_URL}/books/${BOOK_ID}/notes" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"title":"Important point","content":"This chapter explains the main concept clearly."}')"
echo "   status=${ADD_NOTE_STATUS}"
cat /tmp/add_note.json
echo

NOTE_ID="$(cat /tmp/add_note.json | json_get _id)"
if [[ -z "${NOTE_ID}" ]]; then
  echo "Error: add note did not return note _id."
  exit 1
fi
echo "   noteId=${NOTE_ID}"

echo "8) Get notes"
GET_NOTES_STATUS="$(curl -s -o /tmp/get_notes.json -w "%{http_code}" \
  -X GET "${BASE_URL}/books/${BOOK_ID}/notes" \
  -H "Authorization: Bearer ${TOKEN}")"
echo "   status=${GET_NOTES_STATUS}"
cat /tmp/get_notes.json
echo

echo "9) Update note"
UPDATE_NOTE_STATUS="$(curl -s -o /tmp/update_note.json -w "%{http_code}" \
  -X PATCH "${BASE_URL}/books/${BOOK_ID}/notes/${NOTE_ID}" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"title":"Updated point","content":"Updated content from smoke test."}')"
echo "   status=${UPDATE_NOTE_STATUS}"
cat /tmp/update_note.json
echo

echo "10) Delete note"
DELETE_NOTE_STATUS="$(curl -s -o /tmp/delete_note.json -w "%{http_code}" \
  -X DELETE "${BASE_URL}/books/${BOOK_ID}/notes/${NOTE_ID}" \
  -H "Authorization: Bearer ${TOKEN}")"
echo "   status=${DELETE_NOTE_STATUS}"
cat /tmp/delete_note.json
echo

echo "11) Delete book"
DELETE_STATUS="$(curl -s -o /tmp/delete.json -w "%{http_code}" \
  -X DELETE "${BASE_URL}/books/${BOOK_ID}" \
  -H "Authorization: Bearer ${TOKEN}")"
echo "   status=${DELETE_STATUS}"
cat /tmp/delete.json
echo

echo "Smoke test complete."
