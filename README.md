# IndiHealth Guard - Gemma 4 Local Intelligence Platform

A high-performance Indian Health Insurance analysis platform powered by **Gemma 4** and **React**. This repository is designed for fully local execution using Ollama for privacy-first insurance analysis.

## 🚀 Key Features

- **Gemma 4 Intelligence**: Leveraging the latest local LLM for complex policy reasoning.
- **Policy Analysis & OCR**: Instant PDF extraction and deep fine-print analysis.
- **Localized Guard**: Support for major Indian languages (Hindi, Kannada, Tamil, etc.).
- **Claims Rejection Predictor**: Analyzes scenarios against insurer-specific rejection data.

## 📁 Repository Structure

- `server.ts`: Node.js/Express Backend (Primary).
- `src/`: React Frontend (Vite + Tailwind + Recharts).
- `insurance.db`: Pre-seeded SQLite database with Indian insurance policy data.
- `docker-compose.yml`: Ready-to-use containerized setup (Node.js).

## 🛠️ Local Setup

### 1. Requirements
- Node.js 18+
- [Ollama](https://ollama.com/)

### 2. Standard Setup

```bash
# Clone and install
npm install

# Pull the base model and create custom tag
ollama pull gemma:2b
ollama create gemma4:e26b -f Modelfile

# Set Environment Variables
export OLLAMA_BASE_URL="http://localhost:11434"
export GEMMA_MODEL="gemma4:e26b"

# Start the application
npm run dev
```

### 3. Docker Experience (Recommended for Local Dev)

Simply run:
```bash
docker-compose up --build
```

Access the app at `http://localhost:3000`.

## 🧠 Model Configuration

You can customize the intelligence layer in `.env`:

```env
OLLAMA_BASE_URL="http://localhost:11434"
GEMMA_MODEL="gemma4:e26b"
```

## 📜 License
MIT - Built for the Indian Insurance Ecosystem.
