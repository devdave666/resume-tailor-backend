# Resume Tailor - Backend Server

This repository contains the **Node.js backend** for the Resume Tailor Chrome Extension. It handles all secure operations, including API calls to third-party services, payment processing, and file generation. It is designed to be called by the corresponding [frontend extension](https://github.com/YOUR_USERNAME/resume-tailor-extension). 

### Features

* **Secure API Proxy**: Keeps all secret API keys (`OpenAI`, `PDF.co`, `Stripe`) safe on the server.
* **File Parsing**: Uses `multer` for file uploads and an integration with `PDF.co` to extract text from PDF/DOCX files.
* **AI Content Generation**: Communicates with `OpenAI GPT-4o` to generate tailored resumes and cover letters.
* **Document Creation**: Generates downloadable `.docx` and `.pdf` files from text.
* **Payment Processing**: Integrates with `Stripe` for a secure token purchasing system.
* **User Management (Mock)**: Includes a mock database to simulate token management. **For production, this should be replaced with a real database (e.g., PostgreSQL, MongoDB).**

### Project Structure

```
/
├── node_modules/
├── .env
├── .env.example
├── .gitignore
├── package.json
├── package-lock.json
└── server.js
```

### Setup and Installation

**1. Install Dependencies:**
Make sure you have [Node.js](https://nodejs.org/) installed. Then, run the following command in your terminal:

```bash
npm install
```

**2. Configure Environment Variables:**
* Rename the `.env.example` file to `.env`.
* Open the new `.env` file and fill in your secret API keys from OpenAI, PDF.co, and Stripe.
* **Important**: The `.gitignore` file is already set up to prevent your `.env` file from being committed to GitHub.

**3. Run the Server:**
* For development (with automatic reloading on file changes):

    ```bash
    npm run dev
    ```
* For production:

    ```bash
    npm start
    ```

The server will start on `http://localhost:3000` by default.

### API Endpoints

* **`GET /get-token-balance`**
    * Retrieves the current user's token balance.
* **`POST /generate`**
    * The primary endpoint that orchestrates the entire document generation flow.
    * Expects `multipart/form-data` with `resume` (file), `profile` (optional file), and `jobDescription` (text).
    * Returns a JSON object with base64-encoded strings for the four generated files (resume/cover letter in DOCX/PDF formats).
* **`POST /create-payment-session`**
    * Creates a Stripe checkout session and returns its ID to the client for redirection.
* **`POST /webhook-payment-success`**
    * The endpoint that Stripe calls after a successful payment to update a user's token balance. You must configure this URL in your Stripe dashboard.
