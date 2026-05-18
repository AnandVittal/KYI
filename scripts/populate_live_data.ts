import Database from "better-sqlite3";
import { GoogleGenAI } from "@google/genai";

const db = new Database("insurance.db");
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function updateCompanySentiment(companyName: string, searchResults: string) {
    console.log(`Updating sentiment for ${companyName}...`);
    
    const response = await ai.models.generateContent({
        model: "gemini-flash-latest",
        contents: `Analyze the following search results for ${companyName} insurance. 
        Extract:
        1. Social Sentiment for X (Rating 1-5, Positive summary, Negative summary)
        2. Social Sentiment for Reddit (Rating 1-5, Positive summary, Negative summary)
        3. Top 3 Recent Rejection Reasons
        
        Data: ${searchResults}
        
        Respond with a JSON object.`
    });

    const data = JSON.parse(response.text.replace(/```json|```/g, "").trim());
    
    const update = db.prepare(`
        UPDATE insurer_claims_data 
        SET social_sentiment_x = ?, social_sentiment_reddit = ?, rejection_reasons = ?
        WHERE company_name = ?
    `);
    
    update.run(
        JSON.stringify(data.social_sentiment_x),
        JSON.stringify(data.social_sentiment_reddit),
        JSON.stringify(data.rejection_reasons),
        companyName
    );
    
    console.log(`Successfully updated ${companyName}`);
}

// In a real app, this would be triggered via a cron job or admin dashboard
console.log("Live Data Populator Initialized.");
