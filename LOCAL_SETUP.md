# Local Setup Guide: Run with Ollama & Gemma 4

Follow these steps to run this application on your local machine using **Ollama** and the **Gemma 4** model.

## Prerequisites
1. **Node.js**: Install the latest LTS version from [nodejs.org](https://nodejs.org/).
2. **Ollama**: Download and install from [ollama.com](https://ollama.com/).
3. **Download Code**: Export this project as a ZIP or pull it from GitHub.

## Step 1: Install Dependencies
Open your terminal in the project folder and run:
```bash
npm install
```
*Note: If `npm` is not found, you must install Node.js first.*

## Step 2: Set Up Gemma 4 (gemma4:e26b)) in Ollama
Open your terminal and run:
```bash
# Pull the latest gemma model
ollama pull gemma:2b

# Create our specialized gemma4:e26b version using the provided Modelfile
ollama create gemma4:e26b -f Modelfile

# Verify it's running
ollama run gemma4:e26b "Hello, analyze this policy."
```
Ensure the model is created and the Ollama server is running (usually on `http://localhost:11434`).

## Step 3: Configure Environment Variables
Create a `.env` file in the root directory:
```env
# For Gemini API (Production/Default)
GEMINI_API_KEY=your_key_here

# For Local Ollama (Optional override)
OLLAMA_URL=http://localhost:11434
USE_OLLAMA=true
```

## Step 4: Modify server.ts (Local Only)
To use Ollama instead of Gemini, you would modify the `/api/ai/*` routes in `server.ts` to call:
```typescript
const response = await fetch('http://localhost:11434/api/generate', {
  method: 'POST',
  body: JSON.stringify({
    model: 'gemma4',
    prompt: prompt,
    stream: false
  })
});
```

## Step 5: Start the App
Run the development server:
```bash
npm run dev
```
The app will be available at `http://localhost:3000`.

## Common Issues & Fixes

### 1. "RangeError: Too few parameter values were provided"
If you saw this error, it was due to a mismatch between the database table structure and the sample data being added. **I have fixed this in the latest `server.ts`.** The server now correctly fills all 26 columns for health policies and 21 columns for life policies.

### 2. "Missing Gemini API Key"
This app is designed to **prefer local Ollama**. If it asks for an API key, it usually means it couldn't connect to `http://localhost:11434`. 
- Ensure Ollama is running.
- Ensure you have run `ollama pull gemma4`.
- Check if your firewall is blocking port 11434.

## Why "npm install" failed in the Browser?
The AI Studio preview is a restricted sandbox. You cannot run `npm install` there because the environment is already pre-configured. To use `npm install`, you must download the project and run it on your **own machine's terminal**.
