# Local Setup: Insurance Intelligence (Gemma 4 Engine)

This project is optimized to run locally using **Ollama** as the primary intelligence engine (specifically the Gemma 4 / Gemma model family).

## Prerequisites
1. **Node.js**: Version 18 or higher.
2. **Ollama**: Download and install from [ollama.com](https://ollama.com).

## Step 1: Initialize the Intelligence Engine (Gemma 4 Custom)
Open your terminal and run the following commands to set up the gemma4:e26bengine:
```bash
# 1. Pull the base gemma model
ollama pull gemma:2b

# 2. Create the specialized 'gemma4:e26b' version using the included Modelfile
ollama create gemma4:e26b-f Modelfile

# 3. Verify it works
ollama run gemma4:e26b "Hello, help me with insurance."
```
*(Note: Ensure Ollama is running in the background. The app will attempt to connect to `http://localhost:11434` by default.)*

## Step 2: Install Dependencies
Navigate to the project root and install the required npm packages:
```bash
npm install
```

## Step 3: Configure Environment
Create a `.env` file in the root directory (you can copy from `.env.example`):
```env
# Optional: If your Ollama is running on a different port/host
# OLLAMA_HOST=http://localhost:11434
# GEMMA_MODEL=gemma
```

## Step 4: Start the Application
Run the development server which boots both the Backend (Express) and Frontend (Vite):
```bash
npm run dev
```

## Step 5: Access the App
The application will be accessible at:
**http://localhost:3000**

---

### Features included in this build:
- **Know Your Policy**: Local PDF parsing and Gemma-4 analysis.
- **Wealth Strategy**: XIRR vs. Wealth Gap calculations.
- **Claims Analyzer**: Regulatory scenario matching.
- **Multilingual UI**: Full support for regional Indian languages.
- **Insurer Scorecard**: Data-driven metrics for transparency.

### Technical Architecture
- **Frontend**: React 18, Tailwind CSS, Recharts.
- **Backend**: Node.js/Express (better-sqlite3).
- **Engine**: Gemma 4 (gemma4:e26bcustom tag via local Ollama API).
