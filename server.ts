import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import Database from "better-sqlite3";
import multer from "multer";
import { createRequire } from "module";
const require = createRequire(import.meta.url);

let pdfParser: any;
const loadPdfParser = () => {
  if (pdfParser) return pdfParser;
  try {
    const mod = require("pdf-parse");
    pdfParser = typeof mod === "function" ? mod : (mod.default || mod);
    if (typeof pdfParser !== "function" && mod.pdf) {
      pdfParser = mod.pdf; // Some versions export as .pdf
    }
    return pdfParser;
  } catch (e) {
    console.error("Failed to load pdf-parse:", e);
    return null;
  }
};
loadPdfParser();
import zlib from "zlib";
import fs from "fs";
import { GoogleGenerativeAI } from "@google/generative-ai";

const app = express();
const PORT = 3000;

// Request Logger - Move to very top
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// Request Logger - Move to very top
app.use((req, res, next) => {
  console.log(`[SERVER] ${new Date().toISOString()} - ${req.method} ${req.url} - Content-Type: ${req.get('Content-Type')}`);
  next();
});

// TEST ROUTE
app.get("/api/test", (req, res) => {
  res.json({ message: "API is working", time: new Date().toISOString() });
});

const upload = multer({ storage: multer.memoryStorage() });

// New PDF Extraction Endpoint (Backend Side) - Moved to TOP of everything
// Renamed to avoid any potential shadowing issues causing 200 HTML responses
app.get("/api/pdf-extract", (req, res) => {
  res.status(405).json({ error: "Method Not Allowed. Use POST with multipart/form-data to upload a PDF." });
});

app.post("/api/pdf-extract", upload.single("policyFile"), async (req: any, res: any) => {
  console.log(`[API] HIT: POST /api/pdf-extract`);
  console.log(`[API] Content-Type: ${req.get('Content-Type')}`);
  console.log(`[API] File field: ${req.file ? 'Present' : 'ABSENT'}`);
  
  if (!req.file) {
    console.warn("[API] PDF Extraction: No file uploaded");
    return res.status(400).json({ error: "No file uploaded in field 'policyFile'" });
  }

  try {
    const parser = loadPdfParser();
    if (!parser || typeof parser !== "function") {
       throw new Error("PDF parser library (pdf-parse) could not be loaded on the server.");
    }

    const data = await parser(req.file.buffer);
    const text = data?.text || "";
    
    console.log(`[API] PDF Extraction: Filename="${req.file.originalname}", TextLength=${text.length}`);

    if (!text || text.trim().length < 5) {
        console.warn(`[API] PDF Extraction: Text too short (${text.length}) for ${req.file.originalname}`);
        return res.status(400).json({ error: "The provided PDF seems to have very little detectable text. Is it an image-only PDF? We don't support OCR yet." });
    }

    console.log(`[API] PDF Parse Successful for: ${req.file.originalname}`);

    // Store doc tracking info
    const docId = `${Date.now()}-${req.file.originalname}`;
    
    res.json({ 
      success: true, 
      text: text,
      docId: docId,
      size: text.length
    });
  } catch (error: any) {
    console.error("[API] Critical PDF Parse Failure:", error);
    res.status(500).json({ 
      error: "The server encountered an error while reading the PDF content.", 
      details: error?.message || "Internal library error"
    });
  }
});

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
const GEMMA_MODEL = process.env.GEMMA_MODEL || "gemma4:e26b"; 
const CLOUD_GEMMA_MODEL = "gemini-1.5-flash"; 

if (GEMINI_API_KEY) {
  console.log(`[AI] Cloud Intelligence Key detected. Length: ${GEMINI_API_KEY.length}.`);
} else {
  console.warn("[AI] No GEMINI_API_KEY found in environment. Cloud fallback will be disabled.");
}

const genAI = GEMINI_API_KEY ? new GoogleGenerativeAI(GEMINI_API_KEY) : null;

async function callAI(prompt: string, jsonFormat: boolean = true) {
  // Ensure the prompt requests JSON if requested
  const jsonInstruction = jsonFormat ? "\n\nIMPORTANT: Return ONLY a valid JSON object. No markdown, no preamble." : "";
  const aiBrandingPrompt = `[System: You are the KYI Insurance Intelligence Engine. You are a helpful expert in Indian Insurance policies. Direct, clear, and jargon-free.]\n\n${prompt}${jsonInstruction}`;
  
  // 1. Attempt Local Ollama (User Preference)
  console.log(`[AI] Request started. Priority: Local Ollama (${GEMMA_MODEL})`);
  
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120000); // 120s timeout

    const response = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: GEMMA_MODEL,
        prompt: aiBrandingPrompt,
        stream: false,
        format: jsonFormat ? "json" : undefined
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (response.ok) {
      console.log("[AI] Response received from Local Ollama.");
      const data = await response.json() as any;
      const text = data.response;
      
      if (jsonFormat) {
        try {
          return JSON.parse(text);
        } catch (e) {
          const match = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
          if (match) return JSON.parse(match[0]);
          throw new Error("Invalid JSON returned by local model.");
        }
      }
      return text;
    }
  } catch (error: any) {
    console.log(`[AI] Local Ollama unavailable at ${OLLAMA_BASE_URL}. Switching to Cloud fallback...`);
  }

  // 2. Fallback to Cloud (Gemini)
  if (!genAI) {
    throw new Error(`The local AI engine is down and no Cloud API Key is provided. Please start Ollama at ${OLLAMA_BASE_URL}.`);
  }

  const cloudModels = [
    "gemini-1.5-flash",
    "gemini-1.5-flash-latest",
    "gemini-1.5-pro",
    "gemini-1.5-flash-8b",
    "gemini-2.0-flash-exp",
    "gemini-3-flash-preview",
    "gemini-flash-latest"
  ];

  let lastError = null;

  for (const modelName of cloudModels) {
    try {
      console.log(`[AI] Calling Cloud Intelligence (${modelName})`);
      
      const model = genAI.getGenerativeModel({ 
        model: modelName,
        generationConfig: {
          temperature: 0.1,
          responseMimeType: jsonFormat ? "application/json" : undefined
        }
      });

      const result = await model.generateContent(aiBrandingPrompt);
      const response = await result.response;
      let text = response.text();

      if (!text) throw new Error(`Cloud Intelligence (${modelName}) returned an empty response.`);

      // Clean up response if it has markdown blocks
      if (jsonFormat && text.includes("```")) {
         text = text.replace(/```json/g, "").replace(/```/g, "").trim();
      }

      if (jsonFormat) {
        try {
          return JSON.parse(text);
        } catch (e) {
          const match = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
          if (match) return JSON.parse(match[0]);
          throw new Error(`Cloud Intelligence (${modelName}) returned invalid JSON format.`);
        }
      }
      return text;
    } catch (error: any) {
      lastError = error;
      console.warn(`[AI] Cloud model ${modelName} failed: ${error.message}`);
      
      // If it's a quota issue or not found, try the next one
      // We continue to next model regardless for maximum resilience
      continue;
    }
  }

  // If we reach here, all cloud models failed
  const error = lastError;
  console.error("[AI] All Cloud Intelligence fallbacks exhausted.");
  
  let detail = error?.message || "Unknown error";
  
  throw new Error(`The local AI engine at ${OLLAMA_BASE_URL} is down, and the Cloud fallback also failed: ${detail}`);
}

// SQLite setup
const db = new Database("insurance.db");
console.log("[DB] Database connected.");

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", db: !!db });
});

// Initialize tables

db.exec(`
  CREATE TABLE IF NOT EXISTS policies (
    id TEXT PRIMARY KEY,
    company TEXT,
    name TEXT,
    premiumRange TEXT,
    coverage TEXT,
    networkHospitals INTEGER,
    summary TEXT,
    finePrintText TEXT,
    roomRentLimit TEXT,
    waitingPeriodPED TEXT,
    coPay TEXT,
    criticalExclusions TEXT,
    redFlags TEXT,
    preHosp TEXT,
    postHosp TEXT,
    dayCare TEXT,
    domiciliary TEXT,
    ambulance TEXT,
    nonConsumables TEXT,
    renewalDiscount TEXT,
    opd TEXT,
    ayush TEXT,
    organDonor TEXT,
    basePremium INTEGER,
    riders_detailed TEXT,
    comparison_data TEXT
  );

  CREATE TABLE IF NOT EXISTS companies (
    name TEXT PRIMARY KEY,
    description TEXT,
    yearsInBusiness INTEGER,
    customers INTEGER,
    policiesSold INTEGER,
    complaintData TEXT
  );

  CREATE TABLE IF NOT EXISTS insurer_claims_data (
    company_name TEXT PRIMARY KEY,
    overall_rating REAL,
    rejection_reasons TEXT,
    social_sentiment_x TEXT,
    social_sentiment_reddit TEXT,
    shortcomings TEXT,
    easiness_score REAL,
    good_reviews TEXT,
    major_complaints TEXT,
    dos_to_avoid_rejection TEXT
  );

  CREATE TABLE IF NOT EXISTS user_policies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT,
    policy_name TEXT,
    analysis_result TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS translations (
    item_id TEXT,
    item_type TEXT, -- 'policy', 'company', 'ui', 'claim'
    lang TEXT,
    field TEXT,
    content TEXT,
    PRIMARY KEY (item_id, item_type, lang, field)
  );

  CREATE TABLE IF NOT EXISTS document_chunks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    doc_id TEXT,
    chunk_index INTEGER,
    content_zip BLOB,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS life_policies (
    id TEXT PRIMARY KEY,
    company TEXT,
    name TEXT,
    plan_type TEXT, -- Term, Endowment, ULIP
    premiumRange TEXT,
    sumAssured TEXT,
    maturityBenefit TEXT,
    deathBenefit TEXT,
    policyTerm TEXT,
    premiumTerm TEXT,
    riders TEXT, -- JSON
    riders_detailed TEXT,
    comparison_data TEXT,
    summary TEXT,
    finePrintText TEXT,
    morbidityBenefit TEXT,
    criticalExclusions TEXT, -- JSON
    redFlags TEXT, -- JSON
    expectedCAGR REAL,
    expectedXIRR REAL,
    basePremium INTEGER
  );
`);

console.log("[DB] Tables initialized.");

// Migration: Ensure new columns exist
console.log("[DB] Running migrations...");
const migrations = [
  "ALTER TABLE life_policies ADD COLUMN morbidityBenefit TEXT",
  "ALTER TABLE life_policies ADD COLUMN basePremium INTEGER",
  "ALTER TABLE life_policies ADD COLUMN expectedCAGR REAL",
  "ALTER TABLE life_policies ADD COLUMN expectedXIRR REAL",
  "ALTER TABLE life_policies ADD COLUMN riders_detailed TEXT",
  "ALTER TABLE life_policies ADD COLUMN comparison_data TEXT",
  "ALTER TABLE policies ADD COLUMN basePremium INTEGER",
  "ALTER TABLE policies ADD COLUMN riders_detailed TEXT",
  "ALTER TABLE policies ADD COLUMN comparison_data TEXT"
];

for (const sql of migrations) {
  try {
    db.exec(sql);
  } catch (e: any) {
    if (!e.message.includes("duplicate column name")) {
      console.error(`[DB] Migration error on "${sql}":`, e.message);
    }
  }
}
console.log("[DB] Migration check complete.");

// Seed Data
console.log("[DB] Seeding data...");

// Cleanup old misspelled entries if they exist
db.exec(`
  DELETE FROM companies WHERE LOWER(name) IN ('edelweiss toki', 'ageas federa', 'bharti ax');
  DELETE FROM insurer_claims_data WHERE LOWER(company_name) IN ('edelweiss toki', 'ageas federa', 'bharti ax');
  DELETE FROM life_policies WHERE LOWER(company) IN ('edelweiss toki', 'ageas federa', 'bharti ax');
`);

// Add /api/download-modelfile
app.get("/api/download-modelfile", (req, res) => {
  const filePath = path.join(process.cwd(), "Modelfile");
  if (fs.existsSync(filePath)) {
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Content-Disposition', 'attachment; filename=Modelfile');
    res.sendFile(filePath);
  } else {
    res.status(404).send("Modelfile not found");
  }
});

// Final check on company detail route to ensure case-insensitivity and logging
app.get("/api/companies/:name", (req, res) => {
  const name = req.params.name;
  console.log(`[API] Fetching details for company: ${name}`);
  const company = db.prepare("SELECT * FROM companies WHERE LOWER(name) = LOWER(?)").get(name) as any;
  const claimsData = db.prepare("SELECT * FROM insurer_claims_data WHERE LOWER(company_name) = LOWER(?)").get(name) as any;
  
  if (company) {
    res.json({
      ...company,
      complaintData: company.complaintData ? JSON.parse(company.complaintData) : [],
      claimsDetail: claimsData ? {
        ...claimsData,
        rejection_reasons: claimsData.rejection_reasons ? JSON.parse(claimsData.rejection_reasons) : [],
        social_sentiment_x: claimsData.social_sentiment_x ? JSON.parse(claimsData.social_sentiment_x) : {},
        social_sentiment_reddit: claimsData.social_sentiment_reddit ? JSON.parse(claimsData.social_sentiment_reddit) : {},
        dos_to_avoid_rejection: claimsData.dos_to_avoid_rejection ? JSON.parse(claimsData.dos_to_avoid_rejection) : []
      } : null
    });
  } else if (claimsData) {
     res.json({
       name: name,
       description: "Insurer information available via claims data analysis.",
       claimsDetail: {
         ...claimsData,
         rejection_reasons: claimsData.rejection_reasons ? JSON.parse(claimsData.rejection_reasons) : [],
         social_sentiment_x: claimsData.social_sentiment_x ? JSON.parse(claimsData.social_sentiment_x) : {},
         social_sentiment_reddit: claimsData.social_sentiment_reddit ? JSON.parse(claimsData.social_sentiment_reddit) : {},
         dos_to_avoid_rejection: claimsData.dos_to_avoid_rejection ? JSON.parse(claimsData.dos_to_avoid_rejection) : []
       }
     });
  } else {
    console.warn(`[API] Company not found for name: ${name}`);
    res.status(404).json({ error: `Company '${name}' not found` });
  }
});

const seedPolicies = [
  {
    id: "1",
    company: "HDFC ERGO",
    name: "Optima Restore",
    premiumRange: "8,000 - 15,000",
    coverage: JSON.stringify(["Restoration benefit", "No claim bonus", "Daily cash allowance"]),
    networkHospitals: 12000,
    summary: "A popular comprehensive plan known for its restoration benefit where coverage is restored if exhausted.",
    finePrintText: "HDFC ERGO Optima Restore policy terms and conditions: ... (restoration occurs after 100% exhaustion) ... (pre-existing diseases covered after 3 years) ... (maternity not covered) ...",
    roomRentLimit: "No Limit (Any room type)",
    waitingPeriodPED: "3 Years",
    coPay: "No Co-payment",
    criticalExclusions: JSON.stringify(["Maternity", "Cosmetic surgery", "Self-inflicted injuries"]),
    redFlags: JSON.stringify(["Restoration only for different illnesses", "Pre-policy checkup may be required for 45+"]),
    preHosp: "60 Days",
    postHosp: "180 Days",
    dayCare: "All Day Care Procedures",
    domiciliary: "Covered (Up to SI)",
    ambulance: "Up to Rs. 2,000 per hospitalization",
    nonConsumables: "Optional Cover (Add-on)",
    renewalDiscount: "Wellness rewards up to 10%",
    opd: "No OPD (Except as add-on)",
    ayush: "Covered (Up to SI)",
    organDonor: "Covered (Up to SI)",
    basePremium: 9500
  },
  {
    id: "2",
    company: "Star Health",
    name: "Health Premier",
    premiumRange: "10,000 - 20,000",
    coverage: JSON.stringify(["High sum insured", "Modern treatment coverage", "Ayush coverage"]),
    networkHospitals: 14000,
    summary: "Designed for those seeking high coverage limits with various modern treatment options.",
    finePrintText: "Star Health Health Premier terms: ... (Modern treatments capped at 50% of sum insured) ... (Ayush coverage requires 24h hospitalization) ... (Room rent limit: Single private room) ...",
    roomRentLimit: "Single Private A/C Room",
    waitingPeriodPED: "2 Years",
    coPay: "No Co-payment",
    criticalExclusions: JSON.stringify(["Weight control treatments", "Breach of law", "Alcohol related"]),
    redFlags: JSON.stringify(["Modern treatments capped at 50%", "OPD limit is low"]),
    preHosp: "60 Days",
    postHosp: "90 Days",
    dayCare: "All Day Care Procedures",
    domiciliary: "Covered (Up to SI)",
    ambulance: "Air Ambulance covered up to 5L",
    nonConsumables: "Covered",
    renewalDiscount: "N/A",
    opd: "Up to Rs. 5,000",
    ayush: "Covered (Up to SI)",
    organDonor: "Covered (Up to 10% of SI)",
    basePremium: 12000
  },
  {
    id: "3",
    company: "Niva Bupa",
    name: "ReAssure",
    premiumRange: "7,500 - 14,000",
    coverage: JSON.stringify(["ReAssure benefit", "Live Health benefit", "Direct claim settlement"]),
    networkHospitals: 10000,
    summary: "Offers unique benefits like ReAssure where even one claim triggers restoration for subsequent different illnesses.",
    finePrintText: "Niva Bupa ReAssure policy details: ... (ReAssure benefit triggers after first claim) ... (Health checkups covered from day 1) ... (Wait period for PED: 2 years) ...",
    roomRentLimit: "No Limit",
    waitingPeriodPED: "2 Years",
    coPay: "No Co-payment",
    criticalExclusions: JSON.stringify(["STD treatment", "Adventure sports", "Hormone replacement"]),
    redFlags: JSON.stringify(["Waiting period for specific illnesses (2 years)", "Shared room cap for lower SI"]),
    preHosp: "60 Days",
    postHosp: "180 Days",
    dayCare: "All Day Care Procedures",
    domiciliary: "Covered",
    ambulance: "Up to SI",
    nonConsumables: "Covered (ReAssure Forever)",
    renewalDiscount: "Up to 30% (LiveHealth credits)",
    opd: "No OPD",
    ayush: "Full Cover",
    organDonor: "Up to SI",
    basePremium: 8200
  },
  {
    id: "4",
    company: "Care Health",
    name: "Care Supreme",
    premiumRange: "6,500 - 12,000",
    coverage: JSON.stringify(["Care Shield", "Unlimited restoration", "Health check-ups"]),
    networkHospitals: 11000,
    summary: "A value-focused plan with 'Care Shield' that protects the No Claim Bonus and provides annual health check-ups.",
    finePrintText: "Care Supreme fine print: ... (Care Shield is an add-on) ... (Unlimited restoration for different illnesses) ... (OPD coverage is limited) ... (Wait period for heart ailments: 2 years) ...",
    roomRentLimit: "Any Room up to 1% of SI",
    waitingPeriodPED: "4 Years",
    coPay: "No Co-payment",
    criticalExclusions: JSON.stringify(["Dental treatment", "Hearing aids", "Congenital diseases"]),
    redFlags: JSON.stringify(["Room rent cap", "Long wait period for PED"]),
    preHosp: "60 Days",
    postHosp: "90 Days",
    dayCare: "540+ Procedures",
    domiciliary: "Covered",
    ambulance: "Upto Rs. 2,000",
    nonConsumables: "Covered (via Care Shield)",
    renewalDiscount: "No Claim Bonus up to 50%",
    opd: "Add-on available",
    ayush: "Up to SI",
    organDonor: "Up to SI",
    basePremium: 7400
  },
  {
    id: "5",
    company: "ICICI Lombard",
    name: "Health AdvantEdge",
    premiumRange: "9,000 - 18,000",
    coverage: JSON.stringify(["Worldwide cover", "Air ambulance", "Donor expenses"]),
    networkHospitals: 8000,
    summary: "Premium plan offering global coverage and advanced emergency benefits like air ambulance services.",
    finePrintText: "ICICI Health AdvantEdge terms: ... (Worldwide cover excludes USA/Canada unless opted) ... (Air ambulance capped at 5L) ... (Donor expenses covered up to SI) ... (Maternity available after 3 years) ...",
    roomRentLimit: "No Limit",
    waitingPeriodPED: "2 Years",
    coPay: "No Co-payment",
    criticalExclusions: JSON.stringify(["Alternative medicine", "Unproven treatments", "Venereal disease"]),
    redFlags: JSON.stringify(["Global cover excludes USA by default", "Maternity has long wait period"]),
    preHosp: "60 Days",
    postHosp: "180 Days",
    dayCare: "All Procedures",
    domiciliary: "Covered",
    ambulance: "Up to SI",
    nonConsumables: "Covered",
    renewalDiscount: "Wellness points",
    opd: "Limited (Check SI)",
    ayush: "Covered",
    organDonor: "Full SI covered",
    basePremium: 10500
  },
  {
    id: "6",
    company: "Bajaj Allianz",
    name: "Health Guard",
    premiumRange: "7,000 - 13,000",
    coverage: JSON.stringify(["Convalescence benefit", "Daily cash", "Ayurvedic treatment"]),
    networkHospitals: 9000,
    summary: "A balanced plan with good coverage for alternative treatments and specific post-hospitalization recovery benefits.",
    finePrintText: "Bajaj Health Guard terms: ... (Convalescence benefit for 10+ days stay) ... (Ayurvedic treatment in govt hospitals only) ... (Co-payment applicable for age 60+) ...",
    roomRentLimit: "1% of Sum Insured",
    waitingPeriodPED: "3 Years",
    coPay: "20% for Age 60+",
    criticalExclusions: JSON.stringify(["Plastic surgery", "Infertility", "Obesity treatment"]),
    redFlags: JSON.stringify(["Co-payment for seniors", "Strict room rent capping"]),
    preHosp: "60 Days",
    postHosp: "90 Days",
    dayCare: "All",
    domiciliary: "Covered",
    ambulance: "Max limits apply (Rs 5000/yr)",
    nonConsumables: "Not Covered",
    renewalDiscount: "NCB Up to 50%",
    opd: "No OPD",
    ayush: "Govt. Institution only",
    organDonor: "Covered",
    basePremium: 8000
  }
];

const seedCompanies = [
  {
    name: "LIC of India",
    description: "The largest state-owned insurance group and investment company in India, with a history spanning decades.",
    yearsInBusiness: 67,
    customers: 250000000,
    policiesSold: 30000000,
    complaintData: JSON.stringify([
      { year: "2019", rejectionRate: 1.1, totalComplaints: 8000 },
      { year: "2020", rejectionRate: 1.0, totalComplaints: 8500 },
      { year: "2021", rejectionRate: 0.95, totalComplaints: 9000 },
      { year: "2022", rejectionRate: 0.9, totalComplaints: 8800 },
      { year: "2023", rejectionRate: 0.85, totalComplaints: 8200 }
    ])
  },
  {
    name: "Canara HSBC Life",
    description: "A joint venture between Canara Bank and HSBC insurance, known for strong digital-first products and bank-backed trust.",
    yearsInBusiness: 16,
    customers: 8000000,
    policiesSold: 2000000,
    complaintData: JSON.stringify([
      { year: "2021", rejectionRate: 1.2, totalComplaints: 400 },
      { year: "2022", rejectionRate: 1.1, totalComplaints: 450 },
      { year: "2023", rejectionRate: 0.9, totalComplaints: 380 }
    ])
  },
  {
    name: "HDFC Life",
    description: "One of India's leading private life insurance companies, offering a range of individual and group insurance solutions.",
    yearsInBusiness: 23,
    customers: 20000000,
    policiesSold: 5000000,
    complaintData: JSON.stringify([
      { year: "2019", rejectionRate: 0.7, totalComplaints: 1500 },
      { year: "2020", rejectionRate: 0.65, totalComplaints: 1600 },
      { year: "2021", rejectionRate: 0.6, totalComplaints: 1700 },
      { year: "2022", rejectionRate: 0.55, totalComplaints: 1550 },
      { year: "2023", rejectionRate: 0.5, totalComplaints: 1400 }
    ])
  },
  {
    name: "ICICI Pru Life",
    description: "A joint venture between ICICI Bank Limited and Prudential Corporation Holdings Limited.",
    yearsInBusiness: 23,
    customers: 18000000,
    policiesSold: 4500000,
    complaintData: JSON.stringify([
      { year: "2019", rejectionRate: 0.8, totalComplaints: 1800 },
      { year: "2020", rejectionRate: 0.75, totalComplaints: 1900 },
      { year: "2021", rejectionRate: 0.7, totalComplaints: 2000 },
      { year: "2022", rejectionRate: 0.65, totalComplaints: 1850 },
      { year: "2023", rejectionRate: 0.6, totalComplaints: 1700 }
    ])
  },
  {
    name: "SBI Life",
    description: "A joint venture between State Bank of India and BNP Paribas Cardif.",
    yearsInBusiness: 22,
    customers: 22000000,
    policiesSold: 6000000,
    complaintData: JSON.stringify([
      { year: "2019", rejectionRate: 0.9, totalComplaints: 2200 },
      { year: "2020", rejectionRate: 0.85, totalComplaints: 2350 },
      { year: "2021", rejectionRate: 0.8, totalComplaints: 2500 },
      { year: "2022", rejectionRate: 0.75, totalComplaints: 2300 },
      { year: "2023", rejectionRate: 0.7, totalComplaints: 2100 }
    ])
  },
  {
    name: "TATA AIA",
    description: "A joint venture between Tata Sons and AIA Group Limited, the largest independent listed pan-Asian life insurance group.",
    yearsInBusiness: 22,
    customers: 12000000,
    policiesSold: 3000000,
    complaintData: JSON.stringify([
      { year: "2019", rejectionRate: 0.6, totalComplaints: 900 },
      { year: "2020", rejectionRate: 0.55, totalComplaints: 1000 },
      { year: "2021", rejectionRate: 0.5, totalComplaints: 1100 },
      { year: "2022", rejectionRate: 0.45, totalComplaints: 950 },
      { year: "2023", rejectionRate: 0.4, totalComplaints: 850 }
    ])
  },
  {
    name: "Max Life",
    description: "A joint venture between Max Financial Services and Axis Bank, known for high customer-centricity.",
    yearsInBusiness: 23,
    customers: 15000000,
    policiesSold: 4000000,
    complaintData: JSON.stringify([
      { year: "2019", rejectionRate: 0.5, totalComplaints: 1200 },
      { year: "2020", rejectionRate: 0.48, totalComplaints: 1300 },
      { year: "2021", rejectionRate: 0.45, totalComplaints: 1400 },
      { year: "2022", rejectionRate: 0.42, totalComplaints: 1250 },
      { year: "2023", rejectionRate: 0.4, totalComplaints: 1100 }
    ])
  },
  {
    name: "Kotak Life",
    description: "A 100% subsidiary of Kotak Mahindra Bank Limited, catering to a diverse range of customer segments.",
    yearsInBusiness: 22,
    customers: 10000000,
    policiesSold: 2500000,
    complaintData: JSON.stringify([
      { year: "2019", rejectionRate: 1.0, totalComplaints: 1100 },
      { year: "2020", rejectionRate: 0.95, totalComplaints: 1200 },
      { year: "2021", rejectionRate: 0.9, totalComplaints: 1300 },
      { year: "2022", rejectionRate: 0.85, totalComplaints: 1150 },
      { year: "2023", rejectionRate: 0.8, totalComplaints: 1000 }
    ])
  },
  {
    name: "Aditya Birla",
    description: "Part of the Aditya Birla Capital Limited, offering health and life insurance with a focus on wellness.",
    yearsInBusiness: 7,
    customers: 5000000,
    policiesSold: 1500000,
    complaintData: JSON.stringify([
      { year: "2019", rejectionRate: 1.5, totalComplaints: 2500 },
      { year: "2020", rejectionRate: 1.3, totalComplaints: 2700 },
      { year: "2021", rejectionRate: 1.2, totalComplaints: 2900 },
      { year: "2022", rejectionRate: 1.1, totalComplaints: 2600 },
      { year: "2023", rejectionRate: 1.0, totalComplaints: 2300 }
    ])
  },
  {
    name: "HDFC ERGO",
    description: "One of India's largest non-life insurance providers, offering specialized health plans.",
    yearsInBusiness: 22,
    customers: 15000000,
    policiesSold: 9000000,
    complaintData: JSON.stringify([
      { year: "2019", rejectionRate: 0.6, totalComplaints: 1200 },
      { year: "2020", rejectionRate: 0.55, totalComplaints: 1350 },
      { year: "2021", rejectionRate: 0.5, totalComplaints: 1400 },
      { year: "2022", rejectionRate: 0.45, totalComplaints: 1300 },
      { year: "2023", rejectionRate: 0.4, totalComplaints: 1150 }
    ])
  },
  {
    name: "Star Health",
    description: "India's first standalone health insurance company, focusing exclusively on medical coverage.",
    yearsInBusiness: 18,
    customers: 17000000,
    policiesSold: 11000000,
    complaintData: JSON.stringify([
      { year: "2019", rejectionRate: 1.4, totalComplaints: 4500 },
      { year: "2020", rejectionRate: 1.3, totalComplaints: 4800 },
      { year: "2021", rejectionRate: 1.25, totalComplaints: 5200 },
      { year: "2022", rejectionRate: 1.2, totalComplaints: 4900 },
      { year: "2023", rejectionRate: 1.15, totalComplaints: 4600 }
    ])
  },
  {
    name: "Niva Bupa",
    description: "A leading health insurer formed as a joint venture with Bupa Group UK.",
    yearsInBusiness: 16,
    customers: 10000000,
    policiesSold: 6000000,
    complaintData: JSON.stringify([
      { year: "2019", rejectionRate: 1.0, totalComplaints: 2100 },
      { year: "2020", rejectionRate: 0.95, totalComplaints: 2250 },
      { year: "2021", rejectionRate: 0.9, totalComplaints: 2400 },
      { year: "2022", rejectionRate: 0.85, totalComplaints: 2100 },
      { year: "2023", rejectionRate: 0.8, totalComplaints: 1950 }
    ])
  },
  {
    name: "Care Health",
    description: "A specialized health insurer providing innovative products and technology-driven services.",
    yearsInBusiness: 12,
    customers: 8000000,
    policiesSold: 5000000,
    complaintData: JSON.stringify([
      { year: "2019", rejectionRate: 1.1, totalComplaints: 1800 },
      { year: "2020", rejectionRate: 1.05, totalComplaints: 1950 },
      { year: "2021", rejectionRate: 1.0, totalComplaints: 2100 },
      { year: "2022", rejectionRate: 0.95, totalComplaints: 1850 },
      { year: "2023", rejectionRate: 0.9, totalComplaints: 1700 }
    ])
  },
  {
    name: "ICICI Lombard",
    description: "One of the pioneers in the private sector for general insurance in India.",
    yearsInBusiness: 23,
    customers: 25000000,
    policiesSold: 12000000,
    complaintData: JSON.stringify([
      { year: "2019", rejectionRate: 0.5, totalComplaints: 2500 },
      { year: "2020", rejectionRate: 0.48, totalComplaints: 2700 },
      { year: "2021", rejectionRate: 0.45, totalComplaints: 2850 },
      { year: "2022", rejectionRate: 0.42, totalComplaints: 2600 },
      { year: "2023", rejectionRate: 0.4, totalComplaints: 2400 }
    ])
  },
  {
    name: "Bajaj Allianz",
    description: "A joint venture between Bajaj Finserv and Allianz SE, strong player in health insurance.",
    yearsInBusiness: 23,
    customers: 12000000,
    policiesSold: 8000000,
    complaintData: JSON.stringify([
      { year: "2019", rejectionRate: 0.8, totalComplaints: 1500 },
      { year: "2020", rejectionRate: 0.75, totalComplaints: 1650 },
      { year: "2021", rejectionRate: 0.7, totalComplaints: 1800 },
      { year: "2022", rejectionRate: 0.65, totalComplaints: 1600 },
      { year: "2023", rejectionRate: 0.6, totalComplaints: 1450 }
    ])
  },
  {
    name: "Aditya Birla",
    description: "Known for Activ Health plans and wellness-based incentives.",
    yearsInBusiness: 14,
    customers: 5000000,
    policiesSold: 3500000,
    complaintData: JSON.stringify([
      { year: "2019", rejectionRate: 1.2, totalComplaints: 1200 },
      { year: "2020", rejectionRate: 1.15, totalComplaints: 1350 },
      { year: "2021", rejectionRate: 1.1, totalComplaints: 1500 },
      { year: "2022", rejectionRate: 1.05, totalComplaints: 1250 },
      { year: "2023", rejectionRate: 0.95, totalComplaints: 1100 }
    ])
  },
  {
    name: "Future Generali",
    description: "A total insurance solutions provider, joint venture between Future Group and Generali.",
    yearsInBusiness: 17,
    customers: 4000000,
    policiesSold: 2500000,
    complaintData: JSON.stringify([
      { year: "2019", rejectionRate: 1.3, totalComplaints: 1100 },
      { year: "2020", rejectionRate: 1.25, totalComplaints: 1200 },
      { year: "2021", rejectionRate: 1.2, totalComplaints: 1350 },
      { year: "2022", rejectionRate: 1.15, totalComplaints: 1150 },
      { year: "2023", rejectionRate: 1.05, totalComplaints: 1000 }
    ])
  }
];

const seedClaimsData = [
  {
    company_name: "Canara HSBC Life",
    overall_rating: 4.2,
    rejection_reasons: JSON.stringify(["Digital verification gap", "Form mismatch", "Inaccurate health history"]),
    social_sentiment_x: JSON.stringify({ positive: "Low premium for high cover, excellent portal", negative: "Slow paper-based claim process", rating: 4.1 }),
    social_sentiment_reddit: JSON.stringify({ positive: "Best bank-backed insurer, direct bank integration", negative: "Limited agents for offline help", rating: 4.3 }),
    shortcomings: "Limited offline presence in rural areas.",
    easiness_score: 4.3,
    good_reviews: "Users rely on the seamless integration with Canara Bank systems.",
    major_complaints: "Wait times on call support during peak hours.",
    dos_to_avoid_rejection: JSON.stringify([
      "Use the online portal for accurate data entry.",
      "Complete the tele-medical interview honestly.",
      "Verify that your nominee details match bank records."
    ])
  },
  {
    company_name: "HDFC ERGO",
    overall_rating: 4.5,
    rejection_reasons: JSON.stringify(["Incomplete documentation", "Non-medical expenses like gloves/masks", "Pre-existing disease disclosure gap"]),
    social_sentiment_x: JSON.stringify({ positive: "Fast cashless approvals, high settlement trust", negative: "Slow customer support during peak seasons", rating: 4.2 }),
    social_sentiment_reddit: JSON.stringify({ positive: "Highly recommended for families, transparent terms", negative: "Tedious paper claims for non-network hospitals", rating: 4.6 }),
    shortcomings: "Higher premiums compared to smaller players, limited customization for low-budget plans.",
    easiness_score: 4.7,
    good_reviews: "Users love the 'Optima Restore' benefit and the vast network of hospitals.",
    major_complaints: "Some reported 'administrative delays' in reimbursement for smaller cities.",
    dos_to_avoid_rejection: JSON.stringify([
      "Always disclose pre-existing diseases correctly at the time of purchase.",
      "Intimate the insurer within 24 hours of emergency hospitalization.",
      "Submit original prescriptions along with medical bills.",
      "Choose a network hospital for a seamless cashless experience.",
      "Keep a record of all pre-hospitalization consultations for 60 days."
    ])
  },
  {
    company_name: "Star Health",
    overall_rating: 3.8,
    rejection_reasons: JSON.stringify(["Policy exclusions (modern treatments)", "Delay in filing intimation", "Specific disease waiting periods"]),
    social_sentiment_x: JSON.stringify({ positive: "Good for senior citizens, specific disease plans", negative: "Too many documentation requests, slow approval", rating: 3.5 }),
    social_sentiment_reddit: JSON.stringify({ positive: "Good entry-level plans, easy to buy", negative: "Service quality on claims can be hit or miss", rating: 3.9 }),
    shortcomings: "High volume often leads to customer service bottlenecks.",
    easiness_score: 3.6,
    good_reviews: "Comprehensive plans for seniors and wide rural reach.",
    major_complaints: "Frequent complaints about 'frivolous' document queries during claim processing.",
    dos_to_avoid_rejection: JSON.stringify([
      "Read the co-payment clauses carefully before admission.",
      "Avoid hospitals that are blacklisted by the insurer.",
      "Ensure the treating doctor summarizes the diagnosis clearly on the discharge summary.",
      "Request for an initial authorization (pre-auth) as soon as you are admitted.",
      "Verify if modern treatments (Robotic/Laser) are covered under your specific plan."
    ])
  },
  {
    company_name: "Niva Bupa",
    overall_rating: 4.2,
    rejection_reasons: JSON.stringify(["Treatment not 'reasonable & necessary'", "OPD/Cosmetic exclusions", "Wrong hospital categorization"]),
    social_sentiment_x: JSON.stringify({ positive: "Innovative features, direct claim settlement", negative: "Tricky marketing vs actual fine print", rating: 4.0 }),
    social_sentiment_reddit: JSON.stringify({ positive: "Great ReAssure benefit, helpful app", negative: "Claims for rare surgeries often get scrutinized too much", rating: 4.3 }),
    shortcomings: "Some premium plans have confusing 'sub-limits' for specific room types.",
    easiness_score: 4.1,
    good_reviews: "Fastest growing network and digital-first approach is highly appreciated.",
    major_complaints: "Reports of insurance advisors overpromising on 'unlimited' features.",
    dos_to_avoid_rejection: JSON.stringify([
      "Use the Niva Bupa mobile app for real-time claim tracking.",
      "Check the 'Reasonable and Customary' charges applicable in your city.",
      "Double-check room rent eligibility to avoid proportionate deductions.",
      "Inform the TPA desk immediately upon hospital arrival.",
      "Collect all pharmacy invoices; scanned copies might not be enough for reimbursement."
    ])
  },
  {
    company_name: "Care Health",
    overall_rating: 4.0,
    rejection_reasons: JSON.stringify(["PED waiting period violation", "Unproven/Investigational treatments", "Maternity-related exclusions"]),
    social_sentiment_x: JSON.stringify({ positive: "Good tech-based claim tracking", negative: "Claims processing speed dropped in 2023", rating: 3.8 }),
    social_sentiment_reddit: JSON.stringify({ positive: "Value for money plans, Care Shield is great", negative: "Difficult to reach managers for escalated claims", rating: 4.1 }),
    shortcomings: "Renewal premiums sometimes jump significantly based on age brackets.",
    easiness_score: 4.0,
    good_reviews: "Inflation protection features are industry-leading.",
    major_complaints: "Lack of physical branch support in tier-3 cities mentioned by some users.",
    dos_to_avoid_rejection: JSON.stringify([
      "Keep your original health check-up reports as a baseline.",
      "Update your contact details to receive OTPs during claim processing.",
      "Ensure all diagnostic tests have a clear 'advice' note from the doctor.",
      "Submit all documents at once to avoid back-and-forth queries.",
      "Opt for 'Care Shield' to ensure non-medical items (gloves, PPE) are paid."
    ])
  },
  {
    company_name: "ICICI Lombard",
    overall_rating: 4.4,
    rejection_reasons: JSON.stringify(["Reasonable and Customary charges clause", "Domiciliary treatment mismatch", "Alcohol/Drug related incidents"]),
    social_sentiment_x: JSON.stringify({ positive: "Most trusted branding, efficient claim process", negative: "Expensive for budget-conscious users", rating: 4.3 }),
    social_sentiment_reddit: JSON.stringify({ positive: "Reliable during emergencies, good corporate tie-ups", negative: "Strict on PED disclosures, even minor ones", rating: 4.5 }),
    shortcomings: "Strict evaluation policies can be intimidating for first-time claimants.",
    easiness_score: 4.6,
    good_reviews: "High claim settlement ratio consistently maintained for years.",
    major_complaints: "High wait times on calling the national helpline.",
    dos_to_avoid_rejection: JSON.stringify([
      "Disclose even minor surgeries performed in the last 4 years.",
      "Use the 'Anywhere Cashless' feature if admitted to a non-network hospital.",
      "Follow up on the 'Pre-auth' status within 2 hours of submission.",
      "Maintain a folder with all lab reports and previous discharge summaries.",
      "Verify the hospital is categorized correctly (Tier 1 vs Tier 2) as per your policy."
    ])
  },
  {
    company_name: "Bajaj Allianz",
    overall_rating: 4.1,
    rejection_reasons: JSON.stringify(["Admission for 'evaluation only' (not treatment)", "Waiting period for lifestyle diseases", "Excluded outpatient procedures"]),
    social_sentiment_x: JSON.stringify({ positive: "Excellent CSR (Corporate Social Responsibility), good brand", negative: "Limited cashless network in some regions", rating: 3.9 }),
    social_sentiment_reddit: JSON.stringify({ positive: "Stable and long-term player, no surprises", negative: "Rejection of diagnostic admissions is common", rating: 4.2 }),
    shortcomings: "Traditional product structure might feel outdated compared to new age startups.",
    easiness_score: 4.2,
    good_reviews: "Transparent communication through the claim journey.",
    major_complaints: "Lower hospital network density compared to HDFC ERGO.",
    dos_to_avoid_rejection: JSON.stringify([
      "Clear all pending documentation from previous claims before a new one.",
      "Request the hospital to provide a detailed breakup of 'pharmacy' items.",
      "Inform the insurer via their WhatsApp self-service for quick response.",
      "Avoid admitting solely for tests to avoid diagnostic-only rejections.",
      "Check if AYUSH (Ayurvedic/Yoga) treatments require pre-approval."
    ])
  },
  {
    company_name: "Aditya Birla",
    overall_rating: 4.2,
    rejection_reasons: JSON.stringify(["Lack of active treatment evidence", "PED waiting period active", "Non-network hospital co-pay requirements"]),
    social_sentiment_x: JSON.stringify({ positive: "Great rewards for walking/fitness", negative: "Cashless process at small hospitals is tedious", rating: 4.1 }),
    social_sentiment_reddit: JSON.stringify({ positive: "Best for health-conscious young folks", negative: "Hard to track reward points redemption", rating: 4.3 }),
    shortcomings: "Complex reward structure can be confusing for non-tech users.",
    easiness_score: 4.4,
    good_reviews: "Fastest health-checkup report processing.",
    major_complaints: "Bancassurance mis-selling of wellness features.",
    dos_to_avoid_rejection: JSON.stringify(["Keep the Activ Health app updated", "Submit wellness logs correctly", "Get pre-auth for planned surgeries 3 days early"])
  },
  {
    company_name: "Future Generali",
    overall_rating: 4.1,
    rejection_reasons: JSON.stringify(["Specific exclusions gap", "Delay in claim intimation", "Non-medical charges"]),
    social_sentiment_x: JSON.stringify({ positive: "Fast settlement for basic plans", negative: "Customer support is average", rating: 3.8 }),
    social_sentiment_reddit: JSON.stringify({ positive: "Transparent terms, good value", negative: "Network hospitals are limited in some states", rating: 4.0 }),
    shortcomings: "Network density is lower compared to major players.",
    easiness_score: 4.0,
    good_reviews: "Reliable service for standard health plans.",
    major_complaints: "Claim tracking app can be glitchy.",
    dos_to_avoid_rejection: JSON.stringify(["Check if your hospital is network", "Submit pre-auth early", "Keep original prescriptions"])
  },
  {
    company_name: "Kotak Life",
    overall_rating: 4.3,
    rejection_reasons: JSON.stringify(["Nominee mismatch", "Non-disclosure of secondary income sources (relevant for high SA)", "Delayed intimation"]),
    social_sentiment_x: JSON.stringify({ positive: "Fortune Maximiser is a great product, prompt advisor support", negative: "Digital KYC can be buggy", rating: 4.1 }),
    social_sentiment_reddit: JSON.stringify({ positive: "Very responsive during branch visits", negative: "Calculation of bonuses is transparent but complex", rating: 4.2 }),
    shortcomings: "Online portal needs a UX overhaul.",
    easiness_score: 4.2,
    good_reviews: "Reliable brand name with good branch availability.",
    major_complaints: "Bancassurance pushing policies without explaining riders.",
    dos_to_avoid_rejection: JSON.stringify(["Be present for physical medicals if assigned", "Sign all papers yourself", "Verify nominee details via SMS"])
  },
  {
    company_name: "LIC of India",
    overall_rating: 4.6,
    rejection_reasons: JSON.stringify(["Policy lapsed due to non-payment", "Mistake in age declaration", "Incomplete suicide clause wait period"]),
    social_sentiment_x: JSON.stringify({ positive: "Most trusted since decades, easy branch access", negative: "Slow digital response, long queues", rating: 4.5 }),
    social_sentiment_reddit: JSON.stringify({ positive: "Sovereign guarantee is the biggest win", negative: "Agents sometimes misguide to higher commissions", rating: 4.4 }),
    shortcomings: "Digital transition is still in progress compared to private players.",
    easiness_score: 4.8,
    good_reviews: "Users rely on the physical presence in every corner of India.",
    major_complaints: "Manual paperwork needed for many simple tasks.",
    dos_to_avoid_rejection: JSON.stringify([
      "Always keep your policy in 'In-force' status by paying on time.",
      "Submit valid age proof (Passport/10th Certificate) at inception.",
      "Keep your original policy bond safe for maturity/death claims.",
      "Ensure your address is updated for post-office communications."
    ])
  },
  {
    company_name: "HDFC Life",
    overall_rating: 4.5,
    rejection_reasons: JSON.stringify(["Income proof mismatch", "Medical history non-disclosure", "Wrong nominee relationship declaration"]),
    social_sentiment_x: JSON.stringify({ positive: "Fastest digital issuance, great term plans", negative: "Premium suddenly changes after medicals", rating: 4.3 }),
    social_sentiment_reddit: JSON.stringify({ positive: "Best 'Click 2 Protect' series, very reliable", negative: "Higher prices than competition sometimes", rating: 4.6 }),
    shortcomings: "Strict underwriting can lead to 'counter-offers' with higher premiums.",
    easiness_score: 4.7,
    good_reviews: "Seamless online experience and rapid settlement for digital policies.",
    major_complaints: "Tele-medical interviews can be very detailed and repetitive.",
    dos_to_avoid_rejection: JSON.stringify([
      "Upload accurate income documents (Form 16/ITR).",
      "Disclose any habits like smoking/drinking clearly.",
      "Ensure life assured and proposer names match ID proofs exactly.",
      "Download and check the issued policy copy within the 15-day free look period."
    ])
  },
  {
    company_name: "ICICI Pru Life",
    overall_rating: 4.4,
    rejection_reasons: JSON.stringify(["Occupation risks not disclosed", "Lifestyle non-disclosure", "Early death scrutiny (within 3 years)"]),
    social_sentiment_x: JSON.stringify({ positive: "Wide range of ULIPs and Term plans", negative: "Lots of spam calls for upsell", rating: 4.2 }),
    social_sentiment_reddit: JSON.stringify({ positive: "User-friendly app, claims tracking is smooth", negative: "Taxes and charges in ULIPs are complex", rating: 4.4 }),
    shortcomings: "Aggressive sales can lead to buying unsuitable products.",
    easiness_score: 4.5,
    good_reviews: "Quick support via WhatsApp and mobile app.",
    major_complaints: "Difficulty in stopping automated premium deductions if canceled.",
    dos_to_avoid_rejection: JSON.stringify([
      "Mention your correct occupation and nature of work.",
      "Reply strictly to all queries in the 'Tele-MER' call.",
      "Ensure the email ID and phone for OTP is yours, not the agent's.",
      "Verify 'Section 45' of Insurance Act is respected after 3 years."
    ])
  },
  {
    company_name: "SBI Life",
    overall_rating: 4.3,
    rejection_reasons: JSON.stringify(["Geographic risks for overseas travel", "Prior insurance refusal non-disclosure", "Inaccurate health parameters"]),
    social_sentiment_x: JSON.stringify({ positive: "Massive trust due to SBI brand", negative: "Branch staff sometimes lacks technical knowledge", rating: 4.0 }),
    social_sentiment_reddit: JSON.stringify({ positive: "Very stable, no hidden charges in terms", negative: "Online UI is primitive", rating: 4.2 }),
    shortcomings: "Service speed depends heavily on individual bank branches.",
    easiness_score: 4.1,
    good_reviews: "Reliability of a public sector feel with private sector efficiency.",
    major_complaints: "Slow email support response.",
    dos_to_avoid_rejection: JSON.stringify([
      "Visit a branch if the online KYC fails.",
      "Do not leave any column blank in the physical application form.",
      "Check if any previous policy from another company was ever rejected.",
      "Link your Aadhar and PAN correctly for faster processing."
    ])
  },
  {
    company_name: "TATA AIA",
    overall_rating: 4.6,
    rejection_reasons: JSON.stringify(["Aviation/Hazardous sport exclusion", "Non-disclosure of critical illness rider history", "Suicide within 12 months"]),
    social_sentiment_x: JSON.stringify({ positive: "Tata brand trust is unmatched, great service", negative: "Strict medical requirements", rating: 4.5 }),
    social_sentiment_reddit: JSON.stringify({ positive: "Fast claim settlement record, high ratings", negative: "Medical appointments take time to schedule", rating: 4.7 }),
    shortcomings: "Higher rejection of high-value policies during initial medical scan.",
    easiness_score: 4.4,
    good_reviews: "Empathetic claim managers and transparent communication.",
    major_complaints: "Premium quotes are sometimes higher for older ages.",
    dos_to_avoid_rejection: JSON.stringify([
      "Disclose adventure sports involvement if any.",
      "Ensure all medical reports from last 5 years are declared.",
      "Opt for the 'Life Stage Option' if you plan to get married soon.",
      "Check if your current city is in the 'High Risk' zone defined by the company."
    ])
  },
  {
    company_name: "Max Life",
    overall_rating: 4.5,
    rejection_reasons: JSON.stringify(["Smoker status mismatch", "Fraudulent health reports by agents", "Wrong family history"]),
    social_sentiment_x: JSON.stringify({ positive: "Zero-worries claim promise, great tracking", negative: "Customer care holds are long", rating: 4.4 }),
    social_sentiment_reddit: JSON.stringify({ positive: "Top rated for claim settlement ratio", negative: "Documentation for surrender is tedious", rating: 4.6 }),
    shortcomings: "Offline claims can take longer than digital ones.",
    easiness_score: 4.6,
    good_reviews: "Highly professional advisors and detailed policy explains.",
    major_complaints: "Reports of mis-selling 'Saving' as 'FD replacement'.",
    dos_to_avoid_rejection: JSON.stringify([
      "Check if you fall under 'Standard' or 'Sub-standard' life via medicals.",
      "Take photos of your submitted documents for reference.",
      "Ensure your primary nominee is aware of the policy and company name.",
      "Verify that the 'Smoker' status is correctly marked – it's a major reason for death claim rejection."
    ])
  }
];

// Seed claims data
const insertClaimsData = db.prepare(`
  INSERT OR REPLACE INTO insurer_claims_data (
    company_name, overall_rating, rejection_reasons, social_sentiment_x, 
    social_sentiment_reddit, shortcomings, easiness_score, good_reviews, major_complaints,
    dos_to_avoid_rejection
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

seedClaimsData.forEach(c => {
  insertClaimsData.run(
    c.company_name, c.overall_rating, c.rejection_reasons, c.social_sentiment_x, 
    c.social_sentiment_reddit, c.shortcomings, c.easiness_score, c.good_reviews, c.major_complaints,
    c.dos_to_avoid_rejection
  );
});

// Seed policies
const insertPolicy = db.prepare(`
  INSERT OR REPLACE INTO policies (
    id, company, name, premiumRange, coverage, networkHospitals, summary, finePrintText,
    roomRentLimit, waitingPeriodPED, coPay, criticalExclusions, redFlags,
    preHosp, postHosp, dayCare, domiciliary, ambulance, nonConsumables,
    renewalDiscount, opd, ayush, organDonor, basePremium, riders_detailed, comparison_data
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

seedPolicies.forEach(p => {
  const riders = JSON.stringify([
    { name: "Critical Illness Rider", type: "fixed", base: 1200 },
    { name: "Daily Cash Benefit", type: "fixed", base: 500 },
    { name: "No Claim Bonus Protection", type: "percent", base: 5 }
  ]);
  const comparison = JSON.stringify({
    "Room Rent": p.roomRentLimit,
    "PED Wait Period": p.waitingPeriodPED,
    "Co-payment": p.coPay,
    "Ambulance Cover": p.ambulance,
    "Renewal Benefit": p.renewalDiscount
  });
  insertPolicy.run(
    p.id, p.company, p.name, p.premiumRange, p.coverage, p.networkHospitals, p.summary, p.finePrintText,
    p.roomRentLimit, p.waitingPeriodPED, p.coPay, p.criticalExclusions, p.redFlags,
    p.preHosp, p.postHosp, p.dayCare, p.domiciliary, p.ambulance, p.nonConsumables,
    p.renewalDiscount, p.opd, p.ayush, p.organDonor, p.basePremium || 10000,
    riders, comparison
  );
});

// Expansion: More Health Policies
[
  { id: "h5", company: "Niva Bupa", name: "ReAssure 2.0", premiumRange: "12k - 40k", base: 14000, hospitals: 10000, sum: "Modern plan with premium lock." },
  { id: "h6", company: "Care Health", name: "Supreme Plan", premiumRange: "10k - 35k", base: 11000, hospitals: 21000, sum: "Comprehensive cover with recharge." },
  { id: "h7", company: "Aditya Birla", name: "Activ Health Platinum", premiumRange: "9k - 30k", base: 10500, hospitals: 11000, sum: "Rewards for healthy lifestyle." },
  { id: "h8", company: "Star Health", name: "Senior Citizens Red Carpet", premiumRange: "20k - 60k", base: 35000, hospitals: 14000, sum: "Designed for elders 60+." },
  { id: "h9", company: "ICICI Lombard", name: "Health AdvantEdge", premiumRange: "15k - 70k", base: 18500, hospitals: 7500, sum: "Global treatment options." },
  { id: "h10", company: "HDFC ERGO", name: "Optima Secure", premiumRange: "14k - 50k", base: 15800, hospitals: 12000, sum: "4X sum insured benefits." },
  { id: "h11", company: "Bajaj Allianz", name: "Health Guard", premiumRange: "11k - 45k", base: 12200, hospitals: 8500, sum: "Trusted name, simple claims." }
].forEach(p => {
  const ridersDetailed = JSON.stringify([
    { name: "Critical Illness", type: "fixed", base: 1500 },
    { name: "OPD Add-on", type: "fixed", base: 2000 }
  ]);
  const comparison = JSON.stringify({
    "Room Rent": "No Limit",
    "Waiting Period": "36 Months",
    "Co-payment": "0%"
  });
  insertPolicy.run(
    p.id, p.company, p.name, p.premiumRange, JSON.stringify(["Comprehensive coverage"]), p.hospitals, p.sum, "Terms & Conditions apply.",
    "No Limit", "36 Months", "0%", JSON.stringify(["None"]), JSON.stringify(["None"]),
    "60", "90", "All", "Yes", "Yes", "No", "Yes", "No", "Yes", "Yes", p.base,
    ridersDetailed, comparison
  );
});

// Seed Life Policies
const seedLifePolicies = [
  {
    id: "l1",
    company: "LIC of India",
    name: "Tech Term",
    plan_type: "Term Insurance",
    premiumRange: "10,200 - 45,000 (Annual)",
    sumAssured: "50 Lacs - 10 Cr",
    maturityBenefit: "Zero (Pure Protection)",
    deathBenefit: "100% of Sum Assured to Family",
    policyTerm: "10 to 45 Years",
    premiumTerm: "Regular/Limited",
    riders: JSON.stringify(["Accidental Death Benefit", "Critical Illness"]),
    summary: "Pure online term plan with LIC trust, ideal for first-time buyers seeking high cover.",
    finePrintText: "LIC Tech Term: ... No maturity value ... 1 year suicide clause ... Preferential rates for women ...",
    morbidityBenefit: "Lump sum payout on Permanent Disability",
    criticalExclusions: JSON.stringify(["Self-injury", "Hazardous sports"]),
    redFlags: JSON.stringify(["Strict medicals", "No return of premium"]),
    expectedCAGR: 0,
    expectedXIRR: 0,
    basePremium: 10200
  },
  {
    id: "l2",
    company: "HDFC Life",
    name: "Sanchay Plus",
    plan_type: "Endowment / Savings",
    premiumRange: "30,000 - 15,00,000 (Annual)",
    sumAssured: "12x Annual Premium",
    maturityBenefit: "Guaranteed annual income or Lump sum",
    deathBenefit: "Sum Assured on Death plus bonuses",
    policyTerm: "10 to 25 Years",
    premiumTerm: "5 to 12 Years",
    riders: JSON.stringify(["Critical Illness", "Disability Rider"]),
    summary: "Non-participating savings plan providing predictable guaranteed returns.",
    finePrintText: "HDFC Sanchay Plus: Guaranteed if all premiums paid ... Loan allowed ...",
    morbidityBenefit: "Waiver of premium on Total Disability",
    criticalExclusions: JSON.stringify(["Suicide in 1yr"]),
    redFlags: JSON.stringify(["Early surrender loss", "Lock-in period"]),
    expectedCAGR: 5.8,
    expectedXIRR: 6.2,
    basePremium: 35000
  },
  {
    id: "l3",
    company: "ICICI Pru Life",
    name: "Signature",
    plan_type: "ULIP",
    premiumRange: "40,000 - 25,00,000 (Annual)",
    sumAssured: "10x Annual Premium",
    maturityBenefit: "Market-linked fund value",
    deathBenefit: "Higher of Sum Assured or Fund Value",
    policyTerm: "10 to 30 Years",
    premiumTerm: "Single/Limited/Regular",
    riders: JSON.stringify(["Accidental Death", "Waiver of Premium"]),
    summary: "Wealth creation tool with zero premium allocation charges and market exposure.",
    finePrintText: "Signature terms: 5 year lock-in ... Fund switching allowed ...",
    morbidityBenefit: "Waiver of premium + Milestone fund boosters",
    criticalExclusions: JSON.stringify(["Market volatility", "Suicide within 1yr"]),
    redFlags: JSON.stringify(["Lock-in of 5 years", "Net returns vary"]),
    expectedCAGR: 9.3,
    expectedXIRR: 11.8,
    basePremium: 42000
  },
  {
    id: "l4",
    company: "LIC of India",
    name: "New Bima Bachat",
    plan_type: "Money Back",
    premiumRange: "1,50,000 - 50,00,000 (Single)",
    sumAssured: "1.5x Single Premium",
    maturityBenefit: "Single Premium + Loyalty Additions",
    deathBenefit: "Sum Assured on Death",
    policyTerm: "9, 12, 15 Years",
    premiumTerm: "Single Premium",
    riders: JSON.stringify(["None"]),
    summary: "Single premium liquidity plan with periodic survival payouts.",
    finePrintText: "Bima Bachat: Survival benefits every 3 years ...",
    morbidityBenefit: "Survival benefit protection",
    criticalExclusions: JSON.stringify(["Suicide first year"]),
    redFlags: JSON.stringify(["High upfront cost", "Moderate CAGR"]),
    expectedCAGR: 4.8,
    expectedXIRR: 5.1,
    basePremium: 200000
  },
  {
    id: "l5",
    company: "HDFC Life",
    name: "Click 2 Protect Super",
    plan_type: "Term Insurance",
    premiumRange: "12,500 - 60,000",
    sumAssured: "1 Cr - 20 Cr",
    maturityBenefit: "Zero (unless ROP opted)",
    deathBenefit: "Lump sum payout",
    policyTerm: "10 to 85 Years",
    premiumTerm: "Regular/Limited",
    riders: JSON.stringify(["Terminal Illness", "Income Disability"]),
    summary: "Advanced term plan with top-up options for varying life stages.",
    finePrintText: "Click 2 Protect: Terminal illness built-in ...",
    morbidityBenefit: "Inbuilt terminal illness payout",
    criticalExclusions: JSON.stringify(["Suicide"]),
    redFlags: JSON.stringify(["Medical tests mandatory"]),
    expectedCAGR: 0,
    expectedXIRR: 0,
    basePremium: 12500
  },

    {
    id: "l6",
    company: "SBI Life",
    name: "Smart Platina Plus",
    plan_type: "Endowment / Savings",
    premiumRange: "50,000 - 10,00,000 (Annual)",
    sumAssured: "11x to 15x Annual Premium",
    maturityBenefit: "Guaranteed cash bonus + Terminal bonus",
    deathBenefit: "Higher of Sum Assured or Fund value",
    policyTerm: "15 to 30 Years",
    premiumTerm: "7 to 10 Years",
    riders: JSON.stringify(["None included in base"]),
    summary: "Offers life cover and guaranteed income to fulfill long term financial goals.",
    finePrintText: "SBI Smart Platina terms: ... (Income starts after premium term) ... (High premium discounts available) ... (Tax benefits under 80C) ...",
    morbidityBenefit: "Waiver of future premiums on disability",
    criticalExclusions: JSON.stringify(["Suicide within 1 year"]),
    redFlags: JSON.stringify(["Long lock-in before income starts", "Fixed returns might not beat inflation"]),
    expectedCAGR: 5.5,
    expectedXIRR: 5.9,
    basePremium: 50000
  },
  {
    id: "l7",
    company: "ICICI Pru Life",
    name: "Savings Suraksha",
    plan_type: "Money Back",
    premiumRange: "40,000 - 2,00,000 (Annual)",
    sumAssured: "10x Annual Premium",
    maturityBenefit: "Guaranteed additions + Bonuses",
    deathBenefit: "Sum Assured on Death plus bonuses",
    policyTerm: "10 to 25 Years",
    premiumTerm: "5, 7, 10, 12 Years",
    riders: JSON.stringify(["Accidental Death", "Critical Illness"]),
    summary: "A traditional insurance plan that provides guaranteed additions and reversionary bonuses.",
    finePrintText: "ICICI Savings Suraksha details: ... (Guaranteed additions for first 5 years) ... (Participating plan - bonuses not guaranteed) ... (Loan facility available) ...",
    morbidityBenefit: "Annual guaranteed additions continue",
    criticalExclusions: JSON.stringify(["Suicide within 12 months"]),
    redFlags: JSON.stringify(["Bonuses vary based on company performance", "Higher mortality charges than term plans"]),
    expectedCAGR: 6.2,
    expectedXIRR: 6.5,
    basePremium: 40000
  },
  {
    id: "l8",
    company: "SBI Life",
    name: "Smart Wealth Builder",
    plan_type: "ULIP",
    premiumRange: "30,000 - 5,00,000 (Annual)",
    sumAssured: "7x to 20x Annual Premium",
    maturityBenefit: "Fund Value + Guaranteed Additions",
    deathBenefit: "Higher of Sum Assured or Fund Value",
    policyTerm: "5 to 30 Years",
    premiumTerm: "Single/Limited/Regular",
    riders: JSON.stringify(["None"]),
    summary: "A unit linked plan that offers flexibility of choosing from 11 fund options.",
    finePrintText: "SBI Wealth Builder terms: ... (No policy administration charges for first 5 years) ... (Investment risk borne by policyholder) ... (Fund switching allowed) ...",
    morbidityBenefit: "Waiver of premium (if rider selected)",
    criticalExclusions: JSON.stringify(["Market volatility risk", "Suicide within 1 year"]),
    redFlags: JSON.stringify(["Net returns depend on market performance", "5 year lock-in"]),
    expectedCAGR: 9.0,
    expectedXIRR: 11.5,
    basePremium: 30000
  },
  {
    id: "l9",
    company: "LIC of India",
    name: "Jeevan Amar",
    plan_type: "Term Insurance",
    premiumRange: "10,000 - 35,000 (Annual)",
    sumAssured: "25 Lacs - No Limit",
    maturityBenefit: "No maturity benefit",
    deathBenefit: "Lump sum or installments to nominee",
    policyTerm: "10 to 40 Years",
    premiumTerm: "Regular/Limited",
    riders: JSON.stringify(["Accidental Benefit Rider"]),
    summary: "A non-linked, non-participating offline term plan which provides flexibility to the policyholder.",
    finePrintText: "LIC Jeevan Amar: ... (Lower rates for non-smokers and females) ... (High sum assured rebate available) ... (Wait period: 1 year for suicide) ...",
    morbidityBenefit: "Wait of premium on permanent disability",
    criticalExclusions: JSON.stringify(["Suicide", "Hazardous sports", "Criminal acts"]),
    redFlags: JSON.stringify(["Only available offline", "Rigorous medicals"]),
    expectedCAGR: 0,
    expectedXIRR: 0,
    basePremium: 10800
  },
  {
    id: "l10",
    company: "LIC of India",
    name: "Jeevan Labh",
    plan_type: "Endowment / Savings",
    premiumRange: "50,000 - 10,00,000 (Annual)",
    sumAssured: "2 Lacs - No Limit",
    maturityBenefit: "Sum Assured + Bonus + Final Addition Bonus",
    deathBenefit: "Higher of 7x annual premium or Basic SA",
    policyTerm: "16, 21, 25 Years",
    premiumTerm: "10, 15, 16 Years",
    riders: JSON.stringify(["Accidental Death and Disability", "New Term Assurance"]),
    summary: "A high-bonus endowment plan suitable for long term savings and family protection.",
    finePrintText: "LIC Jeevan Labh: ... (Limited premium payment term) ... (Tax benefit under 80C and 10(10D)) ... (Loan available after 2 years) ...",
    morbidityBenefit: "Disability rider allows for monthly income",
    criticalExclusions: JSON.stringify(["Suicide within 1 year"]),
    redFlags: JSON.stringify(["Short premium term usually means high annual cost"]),
    expectedCAGR: 5.9,
    expectedXIRR: 6.3,
    basePremium: 52000
  },
  {
    id: "l11",
    company: "TATA AIA",
    name: "Sampoorna Raksha Supreme",
    plan_type: "Term Insurance",
    premiumRange: "15,000 - 40,000 (Annual)",
    sumAssured: "1 Cr - 20 Cr",
    maturityBenefit: "Option for ROP (Return of Premium)",
    deathBenefit: "Lump sum + Monthly income options",
    policyTerm: "10 to 40 Years",
    premiumTerm: "Regular/Limited/Single",
    riders: JSON.stringify(["Criticare Plus", "Accidental Death Benefit"]),
    summary: "Feature-rich term plan with 'Life Stage Option' to increase cover at marriage or child birth.",
    finePrintText: "TATA AIA Sampoorna Raksha: ... (Accelerator benefit for terminal illness) ... (Preferential rates for non-smokers) ... (Whole life cover up to 100 optional) ...",
    morbidityBenefit: "Payout on 30 critical illnesses",
    criticalExclusions: JSON.stringify(["Pre-existing until wait period ends", "Self-harm"]),
    redFlags: JSON.stringify(["Complex rider structure", "Documentation heavy"]),
    expectedCAGR: 0,
    expectedXIRR: 0,
    basePremium: 15400
  },
  {
    id: "l12",
    company: "Max Life",
    name: "Smart Term Plan",
    plan_type: "Term Insurance",
    premiumRange: "12,000 - 30,000 (Annual)",
    sumAssured: "50 Lacs - 10 Cr",
    maturityBenefit: "Zero (unless Premium Back opted)",
    deathBenefit: "Sum Assured or Increasing Cover",
    policyTerm: "10 to 50 Years",
    premiumTerm: "Regular/Limited/Pay to 60",
    riders: JSON.stringify(["Waiver of Premium", "Critical Illness"]),
    summary: "Highly customizable term plan with 7 variants for different life needs.",
    finePrintText: "Max Life Smart Term: ... (Special rates for non-smokers) ... (Optional cover for high-risk occupations) ... (Death benefit paid as lump sum) ...",
    morbidityBenefit: "Comprehensive CI cover for 40 diseases",
    criticalExclusions: JSON.stringify(["Suicide in 1 year", "Drug abuse related"]),
    redFlags: JSON.stringify(["Base premium increases significantly with riders"]),
    expectedCAGR: 0,
    expectedXIRR: 0,
    basePremium: 12200
  },
  {
    id: "l13",
    company: "HDFC Life",
    name: "Click 2 Wealth",
    plan_type: "ULIP",
    premiumRange: "30,000 - 2,00,000 (Annual)",
    sumAssured: "10x to 15x Annual Premium",
    maturityBenefit: "Fund Value + Return of Mortality Charges",
    deathBenefit: "Higher of Sum Assured or Fund Value",
    policyTerm: "10 to 25 Years",
    premiumTerm: "Single/Limited/Regular",
    riders: JSON.stringify(["None"]),
    summary: "New-age ULIP with 'Return of Mortality Charges' at maturity, maximizing investment.",
    finePrintText: "HDFC Click 2 Wealth: ... (Choice of 11 funds) ... (Systematic withdrawal plan available) ... (Unlimited free switches) ...",
    morbidityBenefit: "Waiver of premium (Premium funding option)",
    criticalExclusions: JSON.stringify(["Suicide first year", "Market risks"]),
    redFlags: JSON.stringify(["5 year lock-in", "Variable fund performance"]),
    expectedCAGR: 9.5,
    expectedXIRR: 12.0
  },
  {
    id: "l14",
    company: "LIC of India",
    name: "Jeevan Umang",
    plan_type: "Endowment / Savings",
    premiumRange: "40,000 - 5,00,000 (Annual)",
    sumAssured: "2 Lacs - No Limit",
    maturityBenefit: "8% of Sum Assured annually after premium term + FAB",
    deathBenefit: "Sum Assured on Death + Bonus",
    policyTerm: "100 - Age at Entry",
    premiumTerm: "15, 20, 25, 30 Years",
    riders: JSON.stringify(["Accident Benefit", "DAB Rider"]),
    summary: "A whole life assurance plan providing annual survival benefits and protection until 100.",
    finePrintText: "LIC Jeevan Umang: ... (Survival benefit starts after premium term) ... (Policy can be surrendered after 2 years) ... (Tax free income under 10(10D)) ...",
    morbidityBenefit: "Accidental disability cover",
    criticalExclusions: JSON.stringify(["Suicide within 1 year"]),
    redFlags: JSON.stringify(["Long commitment required", "Inflation might erode the fixed 8% benefit"]),
    expectedCAGR: 5.6,
    expectedXIRR: 6.0
  },
  {
    id: "l15",
    company: "Bajaj Allianz",
    name: "eTouch Online Term",
    plan_type: "Term Insurance",
    premiumRange: "8,000 - 20,000 (Annual)",
    sumAssured: "50 Lacs - 10 Cr",
    maturityBenefit: "Zero",
    deathBenefit: "Lump sum Sum Assured",
    policyTerm: "10 to 40 Years",
    premiumTerm: "Regular",
    riders: JSON.stringify(["Accidental Death", "Critical Illness"]),
    summary: "Simple, highly affordable online term plan from one of the faster growing private insurers.",
    finePrintText: "Bajaj eTouch: ... (Suicide exclusion 1 year) ... (Terminal illness in-built) ... (No medicals for low SA and young age) ...",
    morbidityBenefit: "Accelerated terminal illness benefit",
    criticalExclusions: JSON.stringify(["Hazardous activities", "Self-inflicted harm"]),
    redFlags: JSON.stringify(["Strict on non-disclosure rejections"]),
    expectedCAGR: 0,
    expectedXIRR: 0
  },
  {
    id: "l16",
    company: "Kotak Life",
    name: "e-Term Plan",
    plan_type: "Term Insurance",
    premiumRange: "10,000 - 30,000 (Annual)",
    sumAssured: "1 Cr - 15 Cr",
    maturityBenefit: "Zero",
    deathBenefit: "Lump sum or part-income",
    policyTerm: "10 to 40 Years",
    premiumTerm: "Regular/Limited",
    riders: JSON.stringify(["Critical Illness Plus", "Permanent Disability"]),
    summary: "A pure protection plan with step-up option to increase cover as life progress.",
    finePrintText: "Kotak e-Term: ... (Option to increase cover at marriage/parenting) ... (Preferential rates for non-tobacco users) ... (Wait period: 1 year for suicide) ...",
    morbidityBenefit: "Monthly income on disability",
    criticalExclusions: JSON.stringify(["Aviation accidents in non-commercial planes", "War"]),
    redFlags: JSON.stringify(["Increasing premium option can be costly later"]),
    expectedCAGR: 0,
    expectedXIRR: 0
  },
  {
    id: "l17",
    company: "Max Life",
    name: "Flexi Wealth Plus",
    plan_type: "ULIP",
    premiumRange: "50,000 - 5,00,000 (Annual)",
    sumAssured: "10x Annual Premium",
    maturityBenefit: "Fund Value + Loyalty Additions",
    deathBenefit: "Higher of Fund Value or Sum Assured",
    policyTerm: "10 to 85 Years",
    premiumTerm: "5, 7, 10, 12 Years",
    riders: JSON.stringify(["None"]),
    summary: "A unit-linked plan with wealth boosters and whole life cover options.",
    finePrintText: "Max Flexi Wealth: ... (No policy admin charges for specific variants) ... (Top-up premiums allowed) ... (Fund switching free) ...",
    morbidityBenefit: "None base",
    criticalExclusions: JSON.stringify(["Market risk", "Suicide 1 year"]),
    redFlags: JSON.stringify(["Charges are high in the first 5 years"]),
    expectedCAGR: 8.5,
    expectedXIRR: 11.0
  },
  {
    id: "l18",
    company: "TATA AIA",
    name: "Fortune Guarantee Plus",
    plan_type: "Endowment / Savings",
    premiumRange: "1,00,000 - 10,00,000 (Annual)",
    sumAssured: "10x to 15x Annual Premium",
    maturityBenefit: "Guaranteed annual income for up to 30 years",
    deathBenefit: "Sum Assured on Death",
    policyTerm: "5 to 12 Years",
    premiumTerm: "5 to 12 Years",
    riders: JSON.stringify(["Critical Illness", "Accidental Death"]),
    summary: "Ensures a steady stream of guaranteed income for a chosen period to meet future goals.",
    finePrintText: "TATA Fortune Guarantee: ... (Flexible income period choice) ... (Lump sum option at end of income period) ... (Wait period for suicide: 1 year) ...",
    morbidityBenefit: "Waiver of premium on disability",
    criticalExclusions: JSON.stringify(["Self-harm", "Criminal acts"]),
    redFlags: JSON.stringify(["Low liquidity during income phase"]),
    expectedCAGR: 5.4,
    expectedXIRR: 5.7
  },
  {
    id: "l19",
    company: "Canara HSBC Life",
    name: "iSelect Smart360",
    plan_type: "Term Insurance",
    premiumRange: "9,000 - 25,000 (Annual)",
    sumAssured: "50 Lacs - 10 Cr",
    maturityBenefit: "Return of Premium (Optional)",
    deathBenefit: "Lump sum",
    policyTerm: "10 to 40 Years",
    premiumTerm: "Regular/Limited/Single",
    riders: JSON.stringify(["Accidental Death", "Waiver of Premium"]),
    summary: "A flexible term plan with optional whole life cover and steady increase in life cover.",
    finePrintText: "Canara HSBC iSelect: ... (Discount for non-smokers and salaried) ... (Option to increase cover by 25% or 50% at milestones) ... (Exit option at age 60) ...",
    morbidityBenefit: "Built-in terminal illness benefit",
    criticalExclusions: JSON.stringify(["Suicide within 1 year"]),
    redFlags: JSON.stringify(["Age limit for 'Return of Premium' option"]),
    expectedCAGR: 0,
    expectedXIRR: 0
  },
  {
    id: "l20",
    company: "Edelweiss Tokio",
    name: "Zindagi Plus",
    plan_type: "Term Insurance",
    premiumRange: "10,000 - 30,000 (Annual)",
    sumAssured: "50 Lacs - 10 Cr",
    maturityBenefit: "Zero",
    deathBenefit: "Better Half Benefit (Insurance for spouse)",
    policyTerm: "10 to 80 Years",
    premiumTerm: "Regular/Limited",
    riders: JSON.stringify(["Critical Illness", "AD&D"]),
    summary: "Innovative term plan ensuring financial security for both yourself and your spouse.",
    finePrintText: "Edelweiss Zindagi Plus: ... (Spouse insurance triggers after death of primary) ... (Flexible premium paying options) ... (Wait period: 1 year) ...",
    morbidityBenefit: "Waiver of premium on 35 critical illnesses",
    criticalExclusions: JSON.stringify(["Suicide", "Self-harm"]),
    redFlags: JSON.stringify(["Premium for 'Better Half' variant is higher"]),
    expectedCAGR: 0,
    expectedXIRR: 0
  },
  {
    id: "l21",
    company: "PNB MetLife",
    name: "Mera Term Plan Plus",
    plan_type: "Term Insurance",
    premiumRange: "10,000 - 35,000 (Annual)",
    sumAssured: "1 Cr - 20 Cr",
    maturityBenefit: "Zero",
    deathBenefit: "Choice of Lump sum, Income, or Combined",
    policyTerm: "10 to 40 Years",
    premiumTerm: "Regular/Limited",
    riders: JSON.stringify(["Accidental Death", "Critical Illness"]),
    summary: "Customizable protection plan with life stage increase and joint life options.",
    finePrintText: "PNB MetLife: ... (Preferential rates for non-smokers) ... (Wait period 1 year) ... (Tele-medicals for healthy young profiles) ...",
    morbidityBenefit: "Lump sum on detection of 10-32 CI",
    criticalExclusions: JSON.stringify(["Suicide in first year"]),
    redFlags: JSON.stringify(["Income option has fixed growth rate which may not match inflation"]),
    expectedCAGR: 0,
    expectedXIRR: 0
  },
  {
    id: "l22",
    company: "LIC of India",
    name: "Jeevan Lakshya",
    plan_type: "Endowment / Savings",
    premiumRange: "30,000 - 5,00,000 (Annual)",
    sumAssured: "1 Lac - No Limit",
    maturityBenefit: "Sum Assured on Maturity + Bonuses",
    deathBenefit: "10% of SA annually till maturity + 110% of SA at maturity",
    policyTerm: "13 to 25 Years",
    premiumTerm: "Policy Term - 3 Years",
    riders: JSON.stringify(["Accidental Death and Disability", "New Term Assurance"]),
    summary: "A limited premium paying plan specifically designed for the benefit of children's education or marriage.",
    finePrintText: "LIC Jeevan Lakshya: ... (Death benefit ensures child study even if parent is absent) ... (Premium waiver on death of proposer) ... (Wait period 1 year) ...",
    morbidityBenefit: "Waiver of premium on disability",
    criticalExclusions: JSON.stringify(["Suicide within 1 year"]),
    redFlags: JSON.stringify(["Bonuses are not guaranteed", "Returns are typically 5-6% CAGR"]),
    expectedCAGR: 5.8,
    expectedXIRR: 6.2
  },
  {
    id: "l23",
    company: "HDFC Life",
    name: "Sanchay Par Advantage",
    plan_type: "Endowment / Savings",
    premiumRange: "1,0,00,000 - 20,00,000 (Annual)",
    sumAssured: "10x to 15x Annual Premium",
    maturityBenefit: "Cash bonuses + Terminal Bonus",
    deathBenefit: "Sum Assured on Death plus bonuses",
    policyTerm: "80 - Age at Entry",
    premiumTerm: "5 to 12 Years",
    riders: JSON.stringify(["Critical Illness", "Accidental Death"]),
    summary: "Participating life insurance plan providing life cover and cash bonuses for immediate needs.",
    finePrintText: "HDFC Sanchay Par: ... (Option to defer bonuses for higher returns) ... (Whole life cover till age 100) ... (Loan against policy allowed) ...",
    morbidityBenefit: "Waiver of premium on disability",
    criticalExclusions: JSON.stringify(["Self-harm", "Suicide within 12 months"]),
    redFlags: JSON.stringify(["Bonuses depend on company fund performance", "High capital commitment"]),
    expectedCAGR: 5.5,
    expectedXIRR: 5.9
  },
  {
    id: "l24",
    company: "Aditya Birla Sun Life",
    name: "DigiShield Plan",
    plan_type: "Term Insurance",
    premiumRange: "10,000 - 45,000 (Annual)",
    sumAssured: "50 Lacs - 10 Cr",
    maturityBenefit: "Return of Premium (Option)",
    deathBenefit: "Lump sum or income payouts",
    policyTerm: "5 to 60 Years",
    premiumTerm: "Regular/Limited/Single",
    riders: JSON.stringify(["Critical Illness", "Waiver of Premium"]),
    summary: "A multi-version term plan allowing whole life cover and survival benefits.",
    finePrintText: "ABSLI DigiShield: ... (Preferential rates for non-smokers and healthy habits) ... (Terminal illness terminal benefit built-in) ... (Wait period 1 year) ...",
    morbidityBenefit: "Lump sum for 42 critical illnesses",
    criticalExclusions: JSON.stringify(["Suicide", "Self-harm", "Dangerous sports"]),
    redFlags: JSON.stringify(["Complex variant choice"]),
    expectedCAGR: 0,
    expectedXIRR: 0
  },
  {
    id: "l25",
    company: "Future Generali",
    name: "Flexi Online Term",
    plan_type: "Term Insurance",
    premiumRange: "9,000 - 22,000 (Annual)",
    sumAssured: "50 Lacs - 5 Cr",
    maturityBenefit: "Zero",
    deathBenefit: "Lump sum",
    policyTerm: "10 to 45 Years",
    premiumTerm: "Regular",
    riders: JSON.stringify(["Accidental Death"]),
    summary: "Simple and straightforward online term insurance plan for primary breadwinners.",
    finePrintText: "Future Generali: ... (No-clue documentation for high SA) ... (Women discounts) ... (Grace period 30 days) ...",
    morbidityBenefit: "Basic waiver of premium",
    criticalExclusions: JSON.stringify(["Suicide within 1 year"]),
    redFlags: JSON.stringify(["Limited network for medicals"]),
    expectedCAGR: 0,
    expectedXIRR: 0,
    basePremium: 14500
  },
  {
    id: "l26",
    company: "Ageas Federal",
    name: "iTerm Plan",
    plan_type: "Term Insurance",
    premiumRange: "11,000 - 28,000 (Annual)",
    sumAssured: "50 Lacs - 5 Cr",
    maturityBenefit: "Zero",
    deathBenefit: "Lump sum",
    policyTerm: "10 to 40 Years",
    premiumTerm: "Regular",
    riders: JSON.stringify(["Critical Illness"]),
    summary: "A pure protection plan with flexible life-stage based cover increase.",
    finePrintText: "Ageas Federal iTerm: ... (Wait period for suicide: 1 year) ... (Tele-medicals allowed for young age) ... (Tax benefit under 80C) ...",
    morbidityBenefit: "Critical illness lump sum",
    criticalExclusions: JSON.stringify(["Self-inflicted injuries"]),
    redFlags: JSON.stringify(["Higher rejection rates in early years (industry trend)"]),
    expectedCAGR: 0,
    expectedXIRR: 0,
    basePremium: 16200
  },
  {
    id: "l27",
    company: "Aegon Life",
    name: "iTerm Prime",
    plan_type: "Term Insurance",
    premiumRange: "8,500 - 18,000 (Annual)",
    sumAssured: "25 Lacs - 5 Cr",
    maturityBenefit: "Zero",
    deathBenefit: "Lump sum",
    policyTerm: "5 to 40 Years",
    premiumTerm: "Regular",
    riders: JSON.stringify(["Insta-claim benefit"]),
    summary: "A digital-first term plan focused on quick claim settlement and simplicity.",
    finePrintText: "Aegon iTerm: ... (Special rates for non-smokers) ... (Critical illness rider can be added) ... (Wait period: 1 year) ...",
    morbidityBenefit: "Terminal illness built-in",
    criticalExclusions: JSON.stringify(["Suicide", "Drug abuse"]),
    redFlags: JSON.stringify(["Lesser physical presence in tier-3 cities"]),
    expectedCAGR: 0,
    expectedXIRR: 0,
    basePremium: 12800
  },
  {
    id: "l28",
    company: "Bharti AXA",
    name: "Flexi Term Pro",
    plan_type: "Term Insurance",
    premiumRange: "12,000 - 32,000 (Annual)",
    sumAssured: "50 Lacs - 10 Cr",
    maturityBenefit: "Zero",
    deathBenefit: "Lump sum",
    policyTerm: "10 to 50 Years",
    premiumTerm: "Regular/Limited",
    riders: JSON.stringify(["Critical Illness", "Accidental Death"]),
    summary: "Comprehensive term plan with options to protect up to age 99.",
    finePrintText: "Bharti AXA: ... (Discount for non-smokers) ... (Accelerated benefit for terminal illness) ... (Wait period 1 year) ... ",
    morbidityBenefit: "Waiver of premium on disability",
    criticalExclusions: JSON.stringify(["Suicide first 12 months"]),
    redFlags: JSON.stringify(["Premiums are slightly on the higher side"]),
    expectedCAGR: 0,
    expectedXIRR: 0,
    basePremium: 19500
  },
  {
    id: "l29",
    company: "Canara HSBC Life",
    name: "Invest 4G",
    plan_type: "ULIP",
    premiumRange: "2,00,000 - 50,00,000 (Annual)",
    sumAssured: "7x to 10x Annual Premium",
    maturityBenefit: "Fund Value + Loyalty Additions + Wealth Boosters",
    deathBenefit: "Higher of Fund Value or Sum Assured",
    policyTerm: "10 to 25 Years",
    premiumTerm: "Limited/Regular",
    riders: JSON.stringify(["None"]),
    summary: "A unit-linked plan with 'Return of Mortality charges' and multiple investment strategies.",
    finePrintText: "Invest 4G: ... (Systematic transfer strategy for market volatility) ... (Wealth boosters at 10th year) ... (Free switches allowed) ...",
    morbidityBenefit: "Premium funding option",
    criticalExclusions: JSON.stringify(["Market risk", "Suicide 1 year"]),
    redFlags: JSON.stringify(["Initial charges are high", "Commitment period 5 years minimum"]),
    expectedCAGR: 9.0,
    expectedXIRR: 11.2
  },
  {
    id: "l30", company: "Kotak Life", name: "Fortune Maximiser", plan_type: "Endowment / Savings", premiumRange: "1,00,000 - 10,00,000 (Annual)", sumAssured: "11x Annual Premium", maturityBenefit: "Guaranteed Payouts + Terminal Bonus", deathBenefit: "Sum Assured on Death plus bonuses", policyTerm: "15 to 40 Years", premiumTerm: "6, 8, 10, 12 Years", riders: JSON.stringify(["Disability Rider"]), summary: "Ensures you maximize your fortune with a combination of life cover and guaranteed savings.", finePrintText: "Kotak Fortune Maximiser: ...", morbidityBenefit: "Lump sum on disability", criticalExclusions: JSON.stringify(["Suicide"]), redFlags: JSON.stringify(["Non-participating component is small", "Bonus depends on fund"]), basePremium: 100000
  },
  {
    id: "l34", company: "PNB MetLife", name: "Mera Term Plan", plan_type: "Term Insurance", premiumRange: "10,000 - 30,000", sumAssured: "50 Lacs - 10 Cr", maturityBenefit: "Zero", deathBenefit: "Lump sum", policyTerm: "10 - 45 Years", premiumTerm: "Regular", riders: JSON.stringify(["None"]), summary: "Affordable protection for your family.", finePrintText: "PNB MetLife: ...", morbidityBenefit: "None", criticalExclusions: JSON.stringify(["Suicide"]), redFlags: JSON.stringify(["Average brand trust"]), basePremium: 14000
  },
  {
    id: "l35", company: "Edelweiss Tokio", name: "Zindagi Plus", plan_type: "Term Insurance", premiumRange: "15,000 - 35,000", sumAssured: "50 Lacs - 5 Cr", maturityBenefit: "Zero", deathBenefit: "Lump sum", policyTerm: "10 - 40 Years", premiumTerm: "Regular", riders: JSON.stringify(["Better Half Benefit"]), summary: "Unique benefit where your spouse gets base cover if you die.", finePrintText: "Edelweiss Tokio: ...", morbidityBenefit: "None", criticalExclusions: JSON.stringify(["Self injury"]), redFlags: JSON.stringify(["Premium load high for riders"]), basePremium: 18000
  },
  {
    id: "h21", company: "Star Health", name: "Senior Citizens Red Carpet", premiumRange: "20,000 - 50,000", coverage: JSON.stringify(["Pre-policy checkup optional", "PED cover after 1yr"]), networkHospitals: 14000, summary: "Designed specifically for older adults over 60.", finePrintText: "Star Senior: ...", roomRentLimit: "1% SI", waitingPeriodPED: "1 Year", coPay: "30% or 50%", criticalExclusions: JSON.stringify(["Cosmetic"]), redFlags: JSON.stringify(["High co-pay is mandatory"]), preHosp: "30 Days", postHosp: "60 Days", dayCare: "Limited", domiciliary: "No", ambulance: "Capped", nonConsumables: "No", renewalDiscount: "N/A", opd: "No", ayush: "No", organDonor: "No", basePremium: 35000
  },
  {
    id: "h22", company: "Future Generali", name: "Health Total", premiumRange: "8,000 - 15,000", coverage: JSON.stringify(["Global coverage", "Waiver of co-pay"]), networkHospitals: 6000, summary: "Value for money overall health plan.", finePrintText: "FG Health Total: ...", roomRentLimit: "Any Room", waitingPeriodPED: "3 Years", coPay: "No", criticalExclusions: JSON.stringify(["War"]), redFlags: JSON.stringify(["Claim settlement duration is high"]), preHosp: "60 Days", postHosp: "90 Days", dayCare: "All", domiciliary: "Yes", ambulance: "Rs 5000", nonConsumables: "No", renewalDiscount: "NCB", opd: "No", ayush: "Yes", organDonor: "Yes", basePremium: 9000
  }
];

// Seed Life Policies
const insertLifePolicy = db.prepare(`
  INSERT OR REPLACE INTO life_policies (
    id, company, name, plan_type, premiumRange, sumAssured, maturityBenefit, 
    deathBenefit, policyTerm, premiumTerm, riders, riders_detailed, comparison_data, summary, finePrintText, 
    morbidityBenefit, criticalExclusions, redFlags, basePremium, expectedCAGR, expectedXIRR
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

seedLifePolicies.forEach(lp => {
  const ridersDetailed = JSON.stringify([
    { name: "Accidental Death Benefit", type: "percent", base: 10 },
    { name: "Critical Illness Rider", type: "fixed", base: 4500 },
    { name: "Waiver of Premium", type: "percent", base: 3 }
  ]);
  const comparison = JSON.stringify({
    "Death Benefit": lp.deathBenefit,
    "Maturity Value": lp.maturityBenefit,
    "Surrender Value": "After 2 years",
    "Loan Facility": "Available",
    "Tax Benefit": "80C & 10(10D)"
  });

  insertLifePolicy.run(
    lp.id, lp.company, lp.name, lp.plan_type, lp.premiumRange, lp.sumAssured, lp.maturityBenefit,
    lp.deathBenefit, lp.policyTerm, lp.premiumTerm, lp.riders, ridersDetailed, comparison, lp.summary, lp.finePrintText,
    lp.morbidityBenefit, lp.criticalExclusions, lp.redFlags, lp.basePremium || 25000,
    (lp as any).expectedCAGR || 0, (lp as any).expectedXIRR || 0
  );
});

// Expansion: More Life Policies
[
  { id: "l36", company: "LIC of India", name: "Jeevan Shanti", type: "Annuity", premium: "1L - 10L", sa: "Varies", base: 100000, sum: "Single premium annuity." },
  { id: "l37", company: "SBI Life", name: "Smart Privilege", type: "ULIP", premium: "2L - 50L", sa: "10x Premium", base: 200000, sum: "High net worth individual plan." },
  { id: "l38", company: "Max Life", name: "Smart Term ROP", type: "Term", premium: "15k - 45k", sa: "1Cr - 5Cr", base: 18000, sum: "Simple term plan with Return of Premium." },
  { id: "l39", company: "Tata AIA", name: "Param Rakshak", type: "ULIP/Term", premium: "1L - 5L", sa: "10x Premium", base: 100000, sum: "Market linked protection." },
  { id: "l40", company: "HDFC Life", name: "Sanchay Fixed Maturity", type: "Savings", premium: "50k - 5L", sa: "10x Premium", base: 50000, sum: "Fixed returns with life cover." },
  { id: "l41", company: "Bajaj Allianz", name: "Life Goal Assure", type: "ULIP", premium: "30k - 2L", sa: "10x Premium", base: 30000, sum: "Focus on retirement or education." },
  { id: "l42", company: "Canara HSBC Life", name: "iSelect Smart", type: "Term", premium: "10k - 40k", sa: "1Cr - 10Cr", base: 12000, sum: "Digital term plan with riders." }
].forEach(p => {
  const isTerm = p.type?.includes("Term") || p.name?.includes("Term");
  const cagr = isTerm ? 0 : (p.type === "ULIP" ? 8.5 : 5.8);
  const xirr = isTerm ? 0 : (p.type === "ULIP" ? 10.5 : 6.1);
  const ridersDetailed = JSON.stringify([
    { name: "Accidental Death", type: "percent", base: 10 },
    { name: "Waiver of Premium", type: "percent", base: 5 }
  ]);
  const comparison = JSON.stringify({
    "Death Benefit": p.sa,
    "Maturity Value": "As per fund performance",
    "Loan": "Available after 3 years"
  });
  insertLifePolicy.run(
    p.id, p.company, p.name, p.type, p.premium, p.sa, "Guaranteed Maturity", "Sum Insured + Bonus",
    "20 Years", "10 Years", "[]", ridersDetailed, comparison, p.sum, "Terms apply.", "N/A", "[]", "[]", p.base, cagr, xirr
  );
});

console.log("[DB] Life policies seeded.");

// Seed companies
const insertCompany = db.prepare(`
  INSERT OR REPLACE INTO companies (name, description, yearsInBusiness, customers, policiesSold, complaintData)
  VALUES (?, ?, ?, ?, ?, ?)
`);

seedCompanies.forEach(c => {
  insertCompany.run(c.name, c.description, c.yearsInBusiness, c.customers, c.policiesSold, c.complaintData);
});

// Seed Life Insurance Companies & Claims
const lifeCompanies = [
  {
    name: "LIC of India",
    description: "The largest and oldest state-owned life insurance corporation in India with massive trust.",
    yearsInBusiness: 67,
    customers: 250000000,
    policiesSold: 300000000,
    complaintData: JSON.stringify([
      { year: "2019", rejectionRate: 0.1, totalComplaints: 25000 },
      { year: "2020", rejectionRate: 0.08, totalComplaints: 28000 },
      { year: "2021", rejectionRate: 0.07, totalComplaints: 30000 },
      { year: "2022", rejectionRate: 0.06, totalComplaints: 29000 },
      { year: "2023", rejectionRate: 0.05, totalComplaints: 27000 }
    ])
  },
  {
    name: "HDFC Life",
    description: "One of the top private life insurers providing a range of individual and group insurance solutions.",
    yearsInBusiness: 23,
    customers: 50000000,
    policiesSold: 40000000,
    complaintData: JSON.stringify([
      { year: "2019", rejectionRate: 0.9, totalComplaints: 5000 },
      { year: "2020", rejectionRate: 0.85, totalComplaints: 5500 },
      { year: "2021", rejectionRate: 0.8, totalComplaints: 5800 },
      { year: "2022", rejectionRate: 0.75, totalComplaints: 5400 },
      { year: "2023", rejectionRate: 0.7, totalComplaints: 5100 }
    ])
  },
  {
    name: "ICICI Pru Life",
    description: "A prominent private sector life insurer known for its technology-driven services and diverse portfolio.",
    yearsInBusiness: 23,
    customers: 45000000,
    policiesSold: 35000000,
    complaintData: JSON.stringify([
      { year: "2019", rejectionRate: 1.1, totalComplaints: 6000 },
      { year: "2020", rejectionRate: 1.0, totalComplaints: 6500 },
      { year: "2021", rejectionRate: 0.95, totalComplaints: 6800 },
      { year: "2022", rejectionRate: 0.9, totalComplaints: 6200 },
      { year: "2023", rejectionRate: 0.85, totalComplaints: 5900 }
    ])
  },
  {
    name: "SBI Life",
    description: "A leading private life insurance company in India, offering a diverse range of products.",
    yearsInBusiness: 23,
    customers: 60000000,
    policiesSold: 55000000,
    complaintData: JSON.stringify([
      { year: "2019", rejectionRate: 0.5, totalComplaints: 4000 },
      { year: "2020", rejectionRate: 0.45, totalComplaints: 4200 },
      { year: "2021", rejectionRate: 0.4, totalComplaints: 4500 },
      { year: "2022", rejectionRate: 0.35, totalComplaints: 4300 },
      { year: "2023", rejectionRate: 0.3, totalComplaints: 4100 }
    ])
  },
  {
    name: "Max Life",
    description: "A joint venture between Max Financial Services and Axis Bank, providing long-term savings and protection.",
    yearsInBusiness: 23,
    customers: 35000000,
    policiesSold: 30000000,
    complaintData: JSON.stringify([
      { year: "2019", rejectionRate: 0.6, totalComplaints: 3000 },
      { year: "2020", rejectionRate: 0.55, totalComplaints: 3200 },
      { year: "2021", rejectionRate: 0.5, totalComplaints: 3400 },
      { year: "2022", rejectionRate: 0.45, totalComplaints: 3100 },
      { year: "2023", rejectionRate: 0.4, totalComplaints: 2900 }
    ])
  },
  {
    name: "Aditya Birla Sun Life",
    description: "One of the leading private sector life insurance companies in India, known for its focus on customer-centricity.",
    yearsInBusiness: 23,
    customers: 25000000,
    policiesSold: 18000000,
    complaintData: JSON.stringify([
      { year: "2019", rejectionRate: 1.2, totalComplaints: 3500 },
      { year: "2020", rejectionRate: 1.1, totalComplaints: 3800 },
      { year: "2021", rejectionRate: 1.05, totalComplaints: 4000 },
      { year: "2022", rejectionRate: 0.98, totalComplaints: 3700 },
      { year: "2023", rejectionRate: 0.92, totalComplaints: 3400 }
    ])
  },
  {
    name: "TATA AIA",
    description: "A joint venture between Tata Sons and AIA Group, focused on protection and wealth management.",
    yearsInBusiness: 22,
    customers: 22000000,
    policiesSold: 15000000,
    complaintData: JSON.stringify([
      { year: "2019", rejectionRate: 0.9, totalComplaints: 2500 },
      { year: "2020", rejectionRate: 0.82, totalComplaints: 2700 },
      { year: "2021", rejectionRate: 0.75, totalComplaints: 2900 },
      { year: "2022", rejectionRate: 0.68, totalComplaints: 2600 },
      { year: "2023", rejectionRate: 0.62, totalComplaints: 2400 }
    ])
  },
  {
    name: "PNB MetLife",
    description: "Leading life insurance company with a strong pan-India presence and innovative protection solutions.",
    yearsInBusiness: 22,
    customers: 15000000,
    policiesSold: 12000000,
    complaintData: JSON.stringify([
      { year: "2019", rejectionRate: 1.5, totalComplaints: 1800 },
      { year: "2020", rejectionRate: 1.4, totalComplaints: 1950 },
      { year: "2021", rejectionRate: 1.35, totalComplaints: 2100 },
      { year: "2022", rejectionRate: 1.25, totalComplaints: 1850 },
      { year: "2023", rejectionRate: 1.15, totalComplaints: 1700 }
    ])
  },
  {
    name: "Edelweiss Tokio",
    description: "Joint venture between Edelweiss and Tokio Marine, known for its customer-centric approach.",
    yearsInBusiness: 13,
    customers: 5000000,
    policiesSold: 3500000,
    complaintData: JSON.stringify([
      { year: "2019", rejectionRate: 0.8, totalComplaints: 1200 },
      { year: "2020", rejectionRate: 0.75, totalComplaints: 1350 },
      { year: "2021", rejectionRate: 0.7, totalComplaints: 1500 },
      { year: "2022", rejectionRate: 0.65, totalComplaints: 1250 },
      { year: "2023", rejectionRate: 0.6, totalComplaints: 1100 }
    ])
  },
  {
    name: "Canara HSBC Life",
    description: "Bancassurance specialist with a strong distribution across its partner banks.",
    yearsInBusiness: 15,
    customers: 8000000,
    policiesSold: 6000000,
    complaintData: JSON.stringify([
      { year: "2019", rejectionRate: 1.0, totalComplaints: 1400 },
      { year: "2020", rejectionRate: 0.95, totalComplaints: 1550 },
      { year: "2021", rejectionRate: 0.9, totalComplaints: 1700 },
      { year: "2022", rejectionRate: 0.85, totalComplaints: 1450 },
      { year: "2023", rejectionRate: 0.8, totalComplaints: 1300 }
    ])
  },
  {
    name: "Ageas Federal",
    description: "Joint venture between Ageas, Federal Bank and IDBI Bank, known for its focus on technology.",
    yearsInBusiness: 15,
    customers: 4000000,
    policiesSold: 3000000,
    complaintData: JSON.stringify([
      { year: "2019", rejectionRate: 1.2, totalComplaints: 800 },
      { year: "2020", rejectionRate: 1.1, totalComplaints: 900 },
      { year: "2021", rejectionRate: 1.0, totalComplaints: 1000 },
      { year: "2022", rejectionRate: 0.9, totalComplaints: 950 },
      { year: "2023", rejectionRate: 0.8, totalComplaints: 850 }
    ])
  },
  {
    name: "Aegon Life",
    description: "Digital-first insurance company providing innovative protection and savings solutions.",
    yearsInBusiness: 15,
    customers: 3000000,
    policiesSold: 2500000,
    complaintData: JSON.stringify([
      { year: "2019", rejectionRate: 1.4, totalComplaints: 700 },
      { year: "2020", rejectionRate: 1.3, totalComplaints: 750 },
      { year: "2021", rejectionRate: 1.2, totalComplaints: 800 },
      { year: "2022", rejectionRate: 1.1, totalComplaints: 780 },
      { year: "2023", rejectionRate: 1.0, totalComplaints: 720 }
    ])
  },
  {
    name: "Bharti AXA",
    description: "Joint venture between Bharti Enterprises and AXA, offering diverse life insurance products.",
    yearsInBusiness: 17,
    customers: 6000000,
    policiesSold: 4500000,
    complaintData: JSON.stringify([
      { year: "2019", rejectionRate: 1.3, totalComplaints: 1100 },
      { year: "2020", rejectionRate: 1.25, totalComplaints: 1200 },
      { year: "2021", rejectionRate: 1.2, totalComplaints: 1300 },
      { year: "2022", rejectionRate: 1.15, totalComplaints: 1250 },
      { year: "2023", rejectionRate: 1.1, totalComplaints: 1150 }
    ])
  }
];

lifeCompanies.forEach(c => {
  insertCompany.run(c.name, c.description, c.yearsInBusiness, c.customers, c.policiesSold, c.complaintData);
});

const lifeClaimsData = [
  {
    company_name: "LIC of India",
    overall_rating: 4.8,
    rejection_reasons: JSON.stringify(["Age proof discrepancy", "Suicide within 12 months", "Fraudulent identity"]),
    social_sentiment_x: JSON.stringify({ positive: "Absolute trust, reliable settlements", negative: "Outdated offices, slow digital response", rating: 4.5 }),
    social_sentiment_reddit: JSON.stringify({ positive: "Excellent for long-term savings, govt backed", negative: "Agents missell policies frequently", rating: 4.7 }),
    shortcomings: "Lower returns in traditional plans compared to modern investments.",
    easiness_score: 4.9,
    good_reviews: "Settlement ratio is the highest in the country.",
    major_complaints: "Bureaucratic delays in some rural branches.",
    dos_to_avoid_rejection: JSON.stringify(["Update nomination details", "Pay premiums on time", "Submit valid age proof"])
  },
  {
    company_name: "HDFC Life",
    overall_rating: 4.3,
    rejection_reasons: JSON.stringify(["Non-disclosure of medical history", "Policy lapse due to non-payment", "Investigational stage deaths"]),
    social_sentiment_x: JSON.stringify({ positive: "Wide range of plans, good tech experience", negative: "High rejection for term plans if health history is fuzzy", rating: 4.1 }),
    social_sentiment_reddit: JSON.stringify({ positive: "Sanchay Plus is a decent savings tool", negative: "Customer service takes time to resolve rider queries", rating: 4.4 }),
    shortcomings: "High mortality charges in some ULIP variants.",
    easiness_score: 4.2,
    good_reviews: "Quick digital onboarding and smooth portal experience.",
    major_complaints: "Disputes over surrender value calculations.",
    dos_to_avoid_rejection: JSON.stringify(["Full medical disclosure", "Check terms in free-look period", "Never sign blank forms"])
  },
  {
    company_name: "ICICI Pru Life",
    overall_rating: 4.2,
    rejection_reasons: JSON.stringify(["Pre-existing morbidity non-disclosure", "Wrong occupation details", "Death due to extreme sports"]),
    social_sentiment_x: JSON.stringify({ positive: "Fastest claims in the private sector", negative: "Aggressive sales tactics by bank partners", rating: 4.0 }),
    social_sentiment_reddit: JSON.stringify({ positive: "Great fund management in ULIPs", negative: "Hidden charges in traditional endowment plans", rating: 4.3 }),
    shortcomings: "Service quality varies across different bancassurance channels.",
    easiness_score: 4.5,
    good_reviews: "Consistently innovating on digital claim processes.",
    major_complaints: "Mis-selling complaints via bank branches are frequent.",
    dos_to_avoid_rejection: JSON.stringify(["Disclose all other policies", "Undergo medical tests properly", "Check settlement ratio split"])
  },
  {
    company_name: "SBI Life",
    overall_rating: 4.5,
    rejection_reasons: JSON.stringify(["Fraudulent claims", "Incorrect bank details", "Non-disclosure of smoking habits"]),
    social_sentiment_x: JSON.stringify({ positive: "Strong backing by SBI, massive presence", negative: "Bank branch staff lacks deep product knowledge", rating: 4.2 }),
    social_sentiment_reddit: JSON.stringify({ positive: "Very safe, low rejection for regular-pay plans", negative: "Process can feel slightly old-school", rating: 4.4 }),
    shortcomings: "Limited flexibility in changing fund managers mid-term.",
    easiness_score: 4.4,
    good_reviews: "Trust factor is as high as public sector insurers.",
    major_complaints: "Forced selling of policies with home loans.",
    dos_to_avoid_rejection: JSON.stringify(["Disclose smoking status", "Ensure KYC is 100% complete", "Confirm auto-debit setup"])
  },
  {
    company_name: "Max Life",
    overall_rating: 4.4,
    rejection_reasons: JSON.stringify(["Technical errors in application", "Over-insurance beyond income", "Early claims within 2 years"]),
    social_sentiment_x: JSON.stringify({ positive: "Zero-hassle documentation for term plans", negative: "Higher premiums for smokers", rating: 4.3 }),
    social_sentiment_reddit: JSON.stringify({ positive: "Best customer service among private players", negative: "Verification calls can be repetitive", rating: 4.5 }),
    shortcomings: "Fewer network partners for medical check-ups in small cities.",
    easiness_score: 4.6,
    good_reviews: "Extremely patient and helpful claim support desk.",
    major_complaints: "Complexity in understanding the 'Return of Premium' math.",
    dos_to_avoid_rejection: JSON.stringify(["Complete video verification carefully", "Provide income proofs correctly", "Keep premium payment receipts"])
  },
  {
    company_name: "Aditya Birla Sun Life",
    overall_rating: 4.1,
    rejection_reasons: JSON.stringify(["Claim within 2 years of PED", "Non-disclosure of lifestyle habits", "Incorrect age proof"]),
    social_sentiment_x: JSON.stringify({ positive: "Innovative DigiShield plan, good mobile app", negative: "Slow response from offline branches", rating: 3.9 }),
    social_sentiment_reddit: JSON.stringify({ positive: "Flexible premium payment options", negative: "Riders are expensive compared to others", rating: 4.0 }),
    shortcomings: "Offline document processing is still slow in some regions.",
    easiness_score: 3.8,
    good_reviews: "Excellent digital tools for policy management.",
    major_complaints: "Delays in refund of excess premiums.",
    dos_to_avoid_rejection: JSON.stringify(["Use the mobile app for claim tracking", "Ensure all PED details are clear", "Check surrender value before exit"])
  },
  {
    company_name: "TATA AIA",
    overall_rating: 4.4,
    rejection_reasons: JSON.stringify(["Critical illness diagnostic discrepancy", "Non-disclosure of other insurance", "Illegal acts related deaths"]),
    social_sentiment_x: JSON.stringify({ positive: "Top-tier claim settlement speed", negative: "Complex documentation requirements", rating: 4.2 }),
    social_sentiment_reddit: JSON.stringify({ positive: "Very professional advisors, clear communication", negative: "Policy terms are very dense", rating: 4.4 }),
    shortcomings: "Technical jargon in policy documents makes it hard for laymen.",
    easiness_score: 4.3,
    good_reviews: "Quick response to death benefit queries.",
    major_complaints: "Wait times for medical reports processing.",
    dos_to_avoid_rejection: JSON.stringify(["Pre-declare all medical consultations", "Verify agent credentials", "Sync policy with DigiLocker"])
  },
  {
    company_name: "Canara HSBC Life",
    overall_rating: 4.1,
    rejection_reasons: JSON.stringify(["Occupation mismatch", "Non-disclosure of other insurance", "Technical errors"]),
    social_sentiment_x: JSON.stringify({ positive: "Good for online term plans, safe", negative: "Customer service response is slow", rating: 3.9 }),
    social_sentiment_reddit: JSON.stringify({ positive: "Transparent and honest about terms", negative: "Difficult to track refund status", rating: 4.1 }),
    shortcomings: "Limited branches in smaller towns.",
    easiness_score: 3.9,
    good_reviews: "Reliable for long-term protection.",
    major_complaints: "Sluggish backend processing mentioned in reviews.",
    dos_to_avoid_rejection: JSON.stringify(["Use original email for all comms", "Verify KYC via App", "Check rider eligibility"])
  },
  {
    company_name: "PNB MetLife",
    overall_rating: 4.0,
    rejection_reasons: JSON.stringify(["Fraudulent claims", "Incomplete nomination", "Delayed claim filing"]),
    social_sentiment_x: JSON.stringify({ positive: "Strong legacy, good brand trust", negative: "Service speed needs improvement", rating: 3.7 }),
    social_sentiment_reddit: JSON.stringify({ positive: "Reliable for family protection", negative: "Process can be very documentation heavy", rating: 3.9 }),
    shortcomings: "Market reach in south India is comparatively low.",
    easiness_score: 3.8,
    good_reviews: "Mera Term Plan is highly recommended by users.",
    major_complaints: "Administrative delays in death claim settlements.",
    dos_to_avoid_rejection: JSON.stringify(["Ensure all forms are legible", "Disclose existing health issues", "Nominee details must match Aadhar"])
  },
  {
    company_name: "Edelweiss Tokio",
    overall_rating: 4.2,
    rejection_reasons: JSON.stringify(["Policy ambiguity", "Incorrect lifestyle data", "Suicide exclusions"]),
    social_sentiment_x: JSON.stringify({ positive: "Innovative Zindagi Plus, good riders", negative: "Premium rates are higher than competitors", rating: 4.0 }),
    social_sentiment_reddit: JSON.stringify({ positive: "Highly flexible plans for young couples", negative: "Confusion over rider benefits", rating: 4.2 }),
    shortcomings: "Premium load for additional riders can be high.",
    easiness_score: 4.1,
    good_reviews: "Spouse benefit is a unique and appreciated feature.",
    major_complaints: "Delays in policy issuance for complex medical cases.",
    dos_to_avoid_rejection: JSON.stringify(["Understand 'Better Half' benefit fully", "Provide clear income proofs", "Pay premiums online for tracking"])
  },
  {
    company_name: "Ageas Federal",
    overall_rating: 4.1,
    rejection_reasons: JSON.stringify(["Medical test discrepancies", "Non-disclosure of smoking history", "Policy surrender within lock-in"]),
    social_sentiment_x: JSON.stringify({ positive: "Simple onboarding, good tech support", negative: "Limited physical presence", rating: 3.8 }),
    social_sentiment_reddit: JSON.stringify({ positive: "iTerm is very transparent", negative: "Customer care holds can be long", rating: 4.0 }),
    shortcomings: "Limited offline presence for senior citizens.",
    easiness_score: 4.0,
    good_reviews: "Very easy to purchase online without agents.",
    major_complaints: "Technical glitches in the mobile app during payment.",
    dos_to_avoid_rejection: JSON.stringify(["Complete medicals honestly", "Check EMI auto-pay status", "Keep Aadhar linked to mobile"])
  },
  {
    company_name: "Aegon Life",
    overall_rating: 4.2,
    rejection_reasons: JSON.stringify(["Incorrect occupation info", "Non-disclosure of travel history", "Late claim submission"]),
    social_sentiment_x: JSON.stringify({ positive: "Pioneer in online term plans", negative: "Trust factor lower than LIC or HDFC", rating: 4.0 }),
    social_sentiment_reddit: JSON.stringify({ positive: "Competitive pricing for young adults", negative: "Claim settlement history is limited in public reports", rating: 4.1 }),
    shortcomings: "Brand awareness is relatively lower in Tier-2 cities.",
    easiness_score: 4.3,
    good_reviews: "No-nonsense plans with simple structures.",
    major_complaints: "Slow response for surrender value requests.",
    dos_to_avoid_rejection: JSON.stringify(["Disclose foreign travel", "Ensure nomination is verified", "Submit clear ID proofs"])
  },
  {
    company_name: "Bharti AXA",
    overall_rating: 4.0,
    rejection_reasons: JSON.stringify(["Fraudulent claims", "Incorrect age proof", "Non-disclosure of existing insurance"]),
    social_sentiment_x: JSON.stringify({ positive: "Wide network of agents, good policy variety", negative: "Claims process feels very manual", rating: 3.9 }),
    social_sentiment_reddit: JSON.stringify({ positive: "Good combo plans for health and life", negative: "Documentation heavy claims", rating: 3.8 }),
    shortcomings: "Digital interface is not as smooth as new-age competitors.",
    easiness_score: 3.7,
    good_reviews: "Strong presence via bank partners.",
    major_complaints: "Confusion over rider benefits and payouts.",
    dos_to_avoid_rejection: JSON.stringify(["Check policy documents for rider terms", "Submit claim offline if portal fails", "Maintain record of all premium payments"])
  }
];

// Insert life claims data using the SAME insertClaimsData prepared statement if it exists, 
// or re-preparing it if needed. Actually it was prepared before seedPolicies.
const insertLifeClaimsData = db.prepare(`
  INSERT OR REPLACE INTO insurer_claims_data (
    company_name, overall_rating, rejection_reasons, social_sentiment_x, 
    social_sentiment_reddit, shortcomings, easiness_score, good_reviews, major_complaints,
    dos_to_avoid_rejection
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

lifeClaimsData.forEach(c => {
  insertLifeClaimsData.run(
    c.company_name, c.overall_rating, c.rejection_reasons, c.social_sentiment_x, 
    c.social_sentiment_reddit, c.shortcomings, c.easiness_score, c.good_reviews, c.major_complaints,
    c.dos_to_avoid_rejection
  );
});

// API Routes
app.get("/api/translations/:lang", (req, res) => {
  const result = db.prepare("SELECT * FROM translations WHERE lang = ?").all(req.params.lang);
  res.json(result);
});

app.post("/api/translations", (req, res) => {
  const { translations } = req.body;
  const insert = db.prepare("INSERT OR REPLACE INTO translations (item_id, item_type, lang, field, content) VALUES (?, ?, ?, ?, ?)");
  
  const transaction = db.transaction((list) => {
    for (const t of list) {
      insert.run(t.item_id, t.item_type, t.lang, t.field, t.content);
    }
  });

  transaction(translations);
  res.json({ success: true });
});

app.post("/api/user-policies", (req, res) => {
  const { userId, policyName, analysisResult } = req.body;
  const insert = db.prepare("INSERT INTO user_policies (user_id, policy_name, analysis_result) VALUES (?, ?, ?)");
  const result = insert.run(userId || "anonymous", policyName, JSON.stringify(analysisResult));
  res.json({ success: true, id: result.lastInsertRowid });
});

app.get("/api/user-policies/:userId", (req, res) => {
  const policies = db.prepare("SELECT * FROM user_policies WHERE user_id = ? ORDER BY created_at DESC").all(req.params.userId || "anonymous");
  res.json(policies.map((p: any) => ({ ...p, analysis_result: JSON.parse(p.analysis_result) })));
});

app.get("/api/policies", (req, res) => {
  const policies = db.prepare("SELECT * FROM policies").all();
  // Parse JSON strings back to arrays
  const parsed = policies.map((p: any) => ({
    ...p,
    coverage: JSON.parse(p.coverage || "[]"),
    criticalExclusions: JSON.parse(p.criticalExclusions || "[]"),
    redFlags: JSON.parse(p.redFlags || "[]"),
    riders_detailed: JSON.parse(p.riders_detailed || "[]"),
    comparison_data: JSON.parse(p.comparison_data || "{}")
  }));
  res.json(parsed);
});

app.get("/api/life-policies", (req, res) => {
  const policies = db.prepare("SELECT * FROM life_policies").all();
  const parsed = policies.map((p: any) => ({
    ...p,
    riders: JSON.parse(p.riders || "[]"),
    riders_detailed: JSON.parse(p.riders_detailed || "[]"),
    comparison_data: JSON.parse(p.comparison_data || "{}"),
    criticalExclusions: JSON.parse(p.criticalExclusions || "[]"),
    redFlags: JSON.parse(p.redFlags || "[]")
  }));
  res.json(parsed);
});

// (Old duplicate route removed)

app.get("/api/insurer-claims", (req, res) => {
  const data = db.prepare("SELECT * FROM insurer_claims_data").all();
  const parsed = data.map((d: any) => ({
    ...d,
    rejection_reasons: JSON.parse(d.rejection_reasons),
    social_sentiment_x: JSON.parse(d.social_sentiment_x),
    social_sentiment_reddit: JSON.parse(d.social_sentiment_reddit),
    dos_to_avoid_rejection: JSON.parse(d.dos_to_avoid_rejection)
  }));
  res.json(parsed);
});

// AI Endpoints (Gemini Primary Engine)
app.post("/api/ai/analyze-uploaded-policy", async (req, res) => {
  try {
    const language = req.body.language || (req.body.data && req.body.data.language);
    const text = (req.body.data && req.body.data.text) || req.body.text;
    
    if (!text) return res.status(400).json({ error: "No text provided for analysis" });

    const prompt = `Analyze this health insurance policy document. Language: ${language || 'English'}.
    Return ONLY a JSON object with this structure:
    {
      "policyName": "string",
      "summary": "string",
      "keyTerms": [{"term": "string", "definition": "string"}],
      "exclusions": [{"exclusion": "string", "description": "string"}],
      "limitations": [{"limitation": "string", "description": "string"}],
      "compliance": {
        "status": "High | Medium | Low",
        "findings": ["finding 1", "finding 2"],
        "ambiguities": ["ambiguity 1"]
      },
      "videoScript": {
        "scenes": [{"text": "string", "subtext": "string", "illustration": "shield|activity|hospital|alert|info", "accent": "blue|emerald|amber"}]
      }
    }
    Policy Text: ${text.slice(0, 50000)}`;
    const result = await callAI(prompt);
    res.json(result);
  } catch (error: any) {
    console.error("AI Analysis Error:", error);
    res.status(500).json({ error: "Analysis failed", details: error.message || String(error) });
  }
});

app.post("/api/ai/analyze-policy-query", async (req, res) => {
  try {
    const language = req.body.language || (req.body.data && req.body.data.language);
    const policy = (req.body.data && req.body.data.policy) || req.body.policy;
    const query = (req.body.data && req.body.data.query) || req.body.query;

    if (!policy || !query) return res.status(400).json({ error: "Policy and query are required" });

    const prompt = `
      You are an expert Indian Health Insurance assistant at "KYI".
      Analyze the following insurance policy details and answer the user's query precisely.
      
      Policy: ${policy.company} - ${policy.name}
      Fine Print Details: ${policy.finePrintText}
      
      User Query: ${query}
      Selected Language for Response: ${language || 'English'}
      
      Return a JSON object with:
      - explanation: Simplified answer.
      - nuances: List of 3 clauses.
      - exclusions: List of 3 items.
      - verdict: Final advice.
      - compliance: { status, findings, ambiguities }
      - videoScript: { scenes: Array(At least 6) }
      Each scene MUST have: text (string), subtext (string), illustration (shield|activity|hospital|alert|info), accent (blue|emerald|amber).
      Ensure all text is in ${language || 'English'}.
    `;
    const result = await callAI(prompt);
    res.json(result);
  } catch (error: any) {
    console.error("AI Query Analysis Error:", error);
    res.status(500).json({ error: "Query analysis failed", details: error.message || String(error) });
  }
});

app.post("/api/ai/recommend", async (req, res) => {
  try {
    const language = req.body.language || (req.body.data && req.body.data.language);
    const profile = (req.body.data && req.body.data.profile) || req.body.profile;
    const policies = (req.body.data && req.body.data.policies) || req.body.policies;

    console.log(`[AI] Recommendation request for ${profile?.name || 'Unknown'}. Profile: ${JSON.stringify(profile).slice(0, 500)}...`);

    const prompt = `
      You are the KYI Insurance Specialist. Analyze the following user profile and recommend the best 2-3 policies from the provided list.
      You must also recommend specific RIDERS that the user should opt for based on their profile.
      
      User Profile: ${JSON.stringify(profile)}
      Policies: ${JSON.stringify(policies)}
  
      Return ONLY a JSON object with this exact structure:
      {
        "recommendations": [
          {
            "policyId": "string matching one of the policy IDs provided",
            "whyRecommended": "Detailed justification (2-3 sentences)",
            "recommendedRiders": ["Rider 1", "Rider 2"],
            "costHighlight": "Summary of costs",
            "comparisonReason": "Why this beats others",
            "userBenefit": "Specific value to this user",
            "insurerTrustVerdict": "Trust rating"
          }
        ]
      }
    `;
    const result = await callAI(prompt);
    
    // Safety check: ensure result has recommendations
    if (!result || !result.recommendations || !Array.isArray(result.recommendations)) {
      console.error("[AI] Invalid Recommendation format:", result);
      throw new Error("AI failed to generate structural recommendations.");
    }

    res.json(result);
  } catch (error: any) {
    console.error("AI Recommendation Error:", error);
    res.status(500).json({ error: "Recommendation failed", details: error.message || String(error) });
  }
});

app.post("/api/ai/translate-policies", async (req, res) => {
  try {
    const language = req.body.language || (req.body.data && req.body.data.language);
    const chunk = (req.body.data && req.body.data.chunk) || req.body.chunk;

    const prompt = `Translate these insurance policies into ${language || 'English'}. 
    Return a JSON ARRAY of objects. 
    Keep the translation natural, crisp, and simple.
    Translate only these fields if present: company, name, summary, coverage, premiumRange, roomRentLimit, waitingPeriodPED, coPay, criticalExclusions, redFlags, maturityBenefit, morbidityBenefit, riders (array of strings), riders_detailed (array of objects - translate "name" field), comparison_data (object - translate values).
    
    IMPORTANT: You MUST maintain all non-translatable fields exactly as they are: id, plan_type, basePremium, expectedCAGR, expectedXIRR, networkHospitals, preHosp, postHosp, etc.
    Do not omit any fields from the original data.
    
    Data: ${JSON.stringify(chunk)}`;
    const result = await callAI(prompt);
    res.json(result);
  } catch (error: any) {
    console.error("AI Translation Error:", error);
    res.status(500).json({ error: "Translation failed", details: error.message || String(error) });
  }
});

app.post("/api/ai/translate-analysis", async (req, res) => {
  try {
    const language = req.body.language || (req.body.data && req.body.data.language);
    const analysis = (req.body.data && req.body.data.analysis) || req.body.analysis;

    const prompt = `Translate this policy analysis result into ${language || 'English'}. Keep the structure exactly as JSON. 
    Translate MUST include: policyName, keyTerms, exclusions, limitations, summary, compliance, and videoScript (all sub-fields).
    Data: ${JSON.stringify(analysis)}`;
    const result = await callAI(prompt);
    res.json(result);
  } catch (error: any) {
    console.error("AI Analysis Translation Error:", error);
    res.status(500).json({ error: "Analysis translation failed", details: error.message || String(error) });
  }
});

app.post("/api/ai/translate-company", async (req, res) => {
  try {
    const language = req.body.language || (req.body.data && req.body.data.language);
    const data = (req.body.data) || req.body;

    const prompt = `Translate these insurance company insights into ${language || 'English'}. 
    Return JSON object with these fields: description, shortcomings, good_reviews, major_complaints.
    Data: ${JSON.stringify(data)}`;
    const result = await callAI(prompt);
    res.json(result);
  } catch (error: any) {
    console.error("AI Company Translation Error:", error);
    res.status(500).json({ error: "Company translation failed", details: error.message || String(error) });
  }
});

app.post("/api/ai/analyze-claim", async (req, res) => {
  try {
    const language = req.body.language || (req.body.data && req.body.data.language);
    const scenario = (req.body.data && req.body.data.scenario) || req.body.scenario;

    const prompt = `
      You are the KYI IRDAI Compliance Specialist. Analyze the following health insurance claim rejection scenario.
      Scenario: ${scenario}
      Language: ${language || 'English'}
      
      You MUST provide a clear, legally-sound analysis based on IRDAI 2024 Master Circulars on Health Insurance.
      Determine if the rejection is 'Compliant', 'Non-Compliant', or 'Partial'.
      
      Return ONLY a JSON object with this structure:
      {
        "assessment": "Detailed 2-3 sentence overview of the situation",
        "complianceStatus": "Compliant | Non-Compliant | Partial",
        "rules": ["Rule 1 with specific IRDAI clause reference", "Rule 2..."],
        "steps": ["Step 1 for the user to take", "Step 2..."],
        "caseStudy": "A similar legal precedent or case study summary",
        "complaintInfo": "Specific info on where to file the complaint"
      }
    `;
    const result = await callAI(prompt);
    res.json(result);
  } catch (error: any) {
    console.error("AI Claim Analysis Error:", error);
    res.status(500).json({ error: "Claim analysis failed", details: error.message || String(error) });
  }
});

app.post("/api/ai/summarize", async (req, res) => {
  try {
    const { text, language } = req.body;
    const prompt = `
      Provide a concise summary of this insurance policy document in ${language || 'English'}.
      Focus on: What is covered, what is NOT covered, and the verdict.
      Return JSON with: title, shortSummary, bulletPoints (array), verdict.
      Text: ${text.slice(0, 20000)}
    `;
    const result = await callAI(prompt);
    res.json(result);
  } catch (error) {
    console.error("AI Summarize Error:", error);
    res.status(500).json({ error: "Summarization failed", details: error instanceof Error ? error.message : String(error) });
  }
});

// 404 for API routes - placed BEFORE SPA fallback
app.all("/api*", (req, res) => {
  console.warn(`[API] 404 - Not Found: ${req.method} ${req.url}`);
  res.status(404).json({ 
    error: "Not Found", 
    message: `API route ${req.method} ${req.url} does not exist on this server.` 
  });
});

async function startServer() {
  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();

// Final Error Handler
app.use((err: any, req: any, res: any, next: any) => {
  console.error("Global Error Handler:", err);
  res.status(500).json({ error: "Internal Server Error", details: err.message });
});
