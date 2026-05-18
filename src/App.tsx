import React, { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Search, Shield, Activity, Plus, X, ChevronRight, MessageSquare, User, Hospital, Info, CheckCircle, TrendingUp, BarChart, Gift, Zap, TrendingDown, Users, Building, ExternalLink, Star, ArrowLeft, ArrowLeftRight, AlertCircle, PlusCircle, Check, Volume2, Globe, Play, Menu, MoreHorizontal, FileText, Download } from "lucide-react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const compound = (p: number, r: number, n: number, pt: number) => {
  let total = 0;
  for (let i = 0; i < n; i++) {
    if (i < pt) total += p;
    total *= (1 + r);
  }
  return Math.round(total);
};

const safeAIResponse = (response: any) => {
  let text = "";
  try {
    if (typeof response.text === "string") {
      text = response.text;
    } else if (typeof response.text === "function") {
      text = response.text();
    } else if (response.response && typeof response.response.text === "function") {
      text = response.response.text();
    } else if (response.candidates && response.candidates[0]?.content?.parts[0]?.text) {
      text = response.candidates[0].content.parts[0].text;
    } else {
      // Fallback for cases where it's already an object or has text elsewhere
      text = response.text || (response.response ? response.response.text : "");
    }
  } catch (e) {
    console.error("Failed to extract text from AI response", e);
  }

  if (!text) {
    console.error("Empty AI response object:", response);
    throw new Error("Empty AI response");
  }
  
  const trimmedText = text.trim();
  if (trimmedText.toLowerCase().startsWith("<!doctype") || trimmedText.toLowerCase().startsWith("<html")) {
    throw new Error("Received HTML response instead of JSON. Backend might be down or API key is restricted.");
  }

  // 1. Try cleaning markdown blocks first
  let cleanText = trimmedText.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
  try {
    return JSON.parse(cleanText);
  } catch (e) {
    // 2. Try extracting the first valid-looking JSON object or array
    const firstBrace = text.indexOf('{');
    const firstBracket = text.indexOf('[');
    const startIdx = (firstBrace !== -1 && (firstBracket === -1 || (firstBrace !== -1 && firstBrace < firstBracket))) ? firstBrace : firstBracket;

    const lastBrace = text.lastIndexOf('}');
    const lastBracket = text.lastIndexOf(']');
    const endIdx = (lastBrace !== -1 && (lastBracket === -1 || lastBrace > lastBracket)) ? lastBrace : lastBracket;

    if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
      const jsonCandidate = text.substring(startIdx, endIdx + 1);
      try {
        return JSON.parse(jsonCandidate);
      } catch (innerE) {
        console.error("Failed to parse extracted JSON block:", innerE);
      }
    }
    
    // 3. Fallback: if it's truncated, AI might have stopped midway. 
    // This is hard to fix perfectly but we log specifically.
    console.error("JSON parse failed. Possibly truncated. Start characters:", text.slice(0, 100));
    throw e;
  }
};

// const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

interface Policy {
  id: string;
  company: string;
  name: string;
  premiumRange: string;
  summary: string;
  finePrintText: string;
  criticalExclusions: string[];
  redFlags: string[];
  basePremium?: number;
  
  // Health specific
  coverage?: string[]; 
  networkHospitals?: number;
  roomRentLimit?: string;
  waitingPeriodPED?: string;
  coPay?: string;
  preHosp?: string;
  postHosp?: string;
  dayCare?: string;
  domiciliary?: string;
  ambulance?: string;
  nonConsumables?: string;
  renewalDiscount?: string;
  opd?: string;
  ayush?: string;
  organDonor?: string;

  // Life specific
  plan_type?: string;
  sumAssured?: string;
  maturityBenefit?: string;
  deathBenefit?: string;
  policyTerm?: string;
  premiumTerm?: string;
  riders?: string[];
  riders_detailed?: { name: string; type: string; base: number }[];
  morbidityBenefit?: string;
  expectedCAGR?: number;
  expectedXIRR?: number;
}

interface CompanyInfo {
  name: string;
  description: string;
  yearsInBusiness: number;
  customers: number;
  policiesSold: number;
  complaintData: {
    year: string;
    rejectionRate: number;
    totalComplaints: number;
  }[];
  claimsDetail?: {
    overall_rating: number;
    rejection_reasons: string[];
    social_sentiment_x: { positive: string; negative: string; rating: number };
    social_sentiment_reddit: { positive: string; negative: string; rating: number };
    shortcomings: string;
    easiness_score: number;
    good_reviews: string;
    major_complaints: string;
  } | null;
}


const safeFetchJSON = async (url: string, options?: RequestInit) => {
  const response = await fetch(url, options);
  const contentType = response.headers.get("content-type");
  
  if (!response.ok) {
    if (contentType && contentType.includes("application/json")) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.details || err.detail || err.error || `Server error ${response.status} at ${url}`);
    }
    if (contentType && contentType.includes("text/html")) {
      throw new Error(`Server returned an error page (HTML) instead of data at ${url}. Status: ${response.status}`);
    }
    throw new Error(`Request failed with status ${response.status} at ${url}`);
  }

  if (!contentType || !contentType.includes("application/json")) {
    const textSample = await response.clone().text().then(t => t.slice(0, 200));
    if (textSample.trim().startsWith("<")) {
      throw new Error(`Received an HTML page instead of JSON data from ${url}. The requested resource might not exist or the application is misconfigured. Status: ${response.status}`);
    }
    throw new Error(`Server returned non-JSON response from ${url}. Content-Type: ${contentType}. Status: ${response.status}`);
  }
  
  return response.json();
};

const translations: any = {
  "English": {
    "explore": "Policy Explorer",
    "compare": "Compare",
    "recommend": "Recommendations",
    "assistant": "Insurance Assistant",
    "heroTitle": "Simplify Your Health Security",
    "heroSub": "Compare Indian health insurance policies without the jargon. Expert summaries of fine print and exclusions.",
    "hospitals": "Hospitals",
    "premium": "Est. Premium",
    "explain": "Explain Fine Print",
    "back": "Back to All",
    "feature": "Feature",
    "gist": "The Gist",
    "verdict": "Expert Verdict",
    "nuances": "Nitty Gritties & Nuances",
    "criticalExclusionsHead": "Critical Exclusions",
    "profileTitle": "Your Profile",
    "age": "Age",
    "maritalStatus": "Marital Status",
    "single": "Single",
    "married": "Married",
    "widow": "Widow",
    "divorced": "Divorced",
    "ped": "Pre-existing Diseases",
    "gender": "Gender",
    "city": "City",
    "lifestyle": "Lifestyle",
    "smoking": "Smoking",
    "drinking": "Drinking",
    "surgery": "Surgery History",
    "medication": "Current Medication",
    "thyroid": "Thyroid",
    "none": "None",
    "generate": "Get Recommendations",
    "topMatches": "Top Matches",
    "scenario": "Scenario / Question",
    "placeholder": "e.g. 'I have diabetes. Does this cover insulin?'",
    "simplify": "Simplify Terms",
    "yearsInBusiness": "Years in Business",
    "activeCustomers": "Active Customers",
    "policiesSold": "Policies Sold / Year",
    "rejectionRate": "Claim Rejection",
    "complaints": "Complaints / 10k",
    "last5Years": "IRDAI Performance (5y)",
    "about": "About Insurer",
    "close": "Close",
    "knowYourPolicy": "Know Your Policy",
    "knowYourPolicyDesc": "Upload your policy to understand it in detail",
    "processing": "Analysing...",
    "keyTerms": "Key Terms",
    "policyExclusions": "Exclusions",
    "limitations": "Limitations",
    "uploadPrompt": "Drop PDF or Click to Browse",
    "analysisComplete": "Analysis Complete",
    "previousAnalyses": "Previous Analyses",
    "compliance": "IRDAI Compliance",
    "claims": "Claims & Compliance",
    "claimDesc": "Understand why your claim was rejected and how to fight it according to IRDAI laws.",
    "rejectionReason": "Reason for Rejection",
    "rejectionPlaceholder": "e.g. 'Claim rejected due to 2 year waiting period for Hernia'",
    "checkCompliance": "Check Compliance",
    "stepsToFight": "Steps to Resolution",
    "caseStudy": "Successful Dispute Case",
    "irdaiComplaint": "IRDAI Bima Bharosa",
    "complianceRules": "Relevant IRDAI Rules",
    "rejectionEmptyState": "Enter rejection details to generate your compliance report and next steps.",
    "visitPortal": "Visit Portal",
    "officialResource": "Official Resource",
    "rejectionAssessment": "Rejection",
    "summary": "Summary",
    "premiumRange": "Premium Range",
    "hospitalNetworks": "Network Hospitals",
    "roomRent": "Room Rent Limit",
    "waitingPeriod": "Waiting Period (PED)",
    "coPay": "Co-payment",
    "preHosp": "Pre-hospitalization",
    "postHosp": "Post-hospitalization",
    "dayCare": "Day Care",
    "domiciliary": "Domiciliary",
    "ambulance": "Ambulance",
    "nonConsumables": "Non-consumables",
    "renewalDiscount": "No Claim Bonus",
    "opd": "OPD Coverage",
    "ayush": "AYUSH",
    "organDonor": "Organ Donor Expenses",
    "whyRecommended": "Why Recommended?",
    "insurerTrust": "Insurer Trust & Reputation",
    "costValue": "Cost & Value",
    "howItCompares": "How it Compares",
    "keyBenefit": "Key Benefit for You",
    "exploreDetails": "Explore Details",
    "auditScore": "Audit Score",
    "basedOnIrdai": "Based on IRDAI 2024 Master Circulars",
    "findingsDeviations": "Findings & Deviations",
    "grayAreas": "Ambiguities / Gray Areas",
    "proTip": "Pro-tip: These gray areas are often used to reject claims. Clarify with the insurer.",
    "compliant": "Compliant",
    "nonCompliant": "Non-Compliant",
    "partialCompliant": "Partially Compliant",
    "rejection": "Rejection",
    "skip": "Skip",
    "planType": "Plan Type",
    "sumAssured": "Sum Assured",
    "whatWorksBetter": "What Works Better?",
    "strategyComparison": "Strategy Comparison",
    "maturity": "Maturity Benefits",
    "deathCover": "Total Death Cover",
    "termFdStrategy": "Term Insurance + FD/Bond",
    "termMfStrategy": "Term Insurance + Index MF",
    "maturityBenefit": "Maturity Benefit",
    "deathBenefit": "Death Benefit",
    "policyTerm": "Policy Term",
    "premiumTerm": "Premium Term",
    "riders": "Riders / Add-ons",
    "morbidityBenefit": "Morbidity Benefit",
    "maturityPayout": "Maturity Payout",
    "estIrr": "Estimated IRR",
    "hideComparison": "Hide Comparison",
    "annualSplit": "Annual Split",
    "estMaturity": "Estimated Maturity",
    "deathLifeCover": "Life Cover (Death)",
    "flexibility": "Flexibility",
    "fullToInsurer": "Full to Insurer",
    "buyTermInvestDiff": "Buy Term & Invest Difference",
    "splitPremiumAdvise_part1": "Split your",
    "splitPremiumAdvise_part2": "premium for 10x more cover and better returns.",
    "proTipStrategy": "Pro Tip: Traditional 'Savings' insurance plans often give 5-6% returns with low cover. Separating your insurance (Pure Term) and your investments (FD/MF) gives you better protection and higher wealth growth for the same budget.",
    "termFd7": "Term + FD (7%)",
    "termMf12": "Term + MF (12%)",
    "termMf10": "Term + MF (10%)",
    "traditional": "Traditional",
    "timePeriod": "Time Period",
    "termPremiumTitle": "Term Premium (1 Cr Cover)",
    "lockedLow": "Locked (Low)",
    "fullPartial": "Full (Partial)",
    "highFlex": "High Flex",
    "comparisonMetric": "Comparison metric",
    "netGain": "Net Gain (Above Premium)",
    "totalPremiumPaid": "Total Premium Paid",
    "payoutAnalysis": "Payout Analysis",
    "event": "Event",
    "benefitType": "Benefit Type",
    "amount": "Amount",
    "zeroProtection": "Zero (Pure Protection)",
    "returnsCalc": "Returns Calculator",
    "xirr": "XIRR",
    "cagr": "CAGR",
    "selectRiders": "Select Riders",
    "totalPremium": "Total Premium",
    "compoundedAnnually": "Compounded Annually",
    "comparisonTable": "Policy Comparison Table",
    "currentAge": "Your Current Age",
    "yes": "Yes",
    "no": "No",
    "smoker": "Smoker?",
    "expertVerdict": "Expert Verdict",
    "illustrativeNotice": "All values are illustrative based on standard industry assumptions.",
    "clearSelections": "Clear Selections",
    "pureProtectionDesc": "This is a pure protection plan. Every rupee goes towards buying a massive life cover. High efficiency for family security.",
    "savingsMaturityDesc": "At age {age}, you pay for {years} years. The CAGR is roughly {cagr}%. Good for low-risk long-term goals.",
    "policyEnd": "Policy End",
    "maturitySurvival": "Maturity / Survival",
    "deathBenefitLabel": "Death Benefit",
    "deathImmediate": "Death (Immediate)",
    "morbidity": "Morbidity",
    "disabilityCritical": "Disability / Critical",
    "plan": "Plan",
    "avoidRejectionHead": "How to Avoid Claim Rejection",
    "dos": "DOs",
    "donts": "DON'Ts",
    "trustScore": "Trust Score",
    "summaryDashboard": "Summary Dashboard",
    "lessData": "Less Data",
    "detailedView": "Detailed View",
    "experience": "Experience",
    "trustIndex": "Trust Index",
    "whyDenied": "Why Claims Get Denied",
    "dosButton": "DOs to avoid claim rejection",
    "do1": "Always disclose Pre-Existing Diseases (PED) during purchase.",
    "do2": "Directly pay hospitals for consumables if not covered.",
    "do3": "Check if the hospital is in the insurer's Network List.",
    "do4": "Submit all original bills and discharge summaries.",
    "do5": "Inform the insurer within 24-48 hours of emergency hospitalization.",
    "dont1": "Don't rely solely on the agent's verbal promises.",
    "dont2": "Don't hide surgery history or lifestyle habits like smoking.",
    "dont3": "Don't wait for discharge to start the 'pre-auth' process.",
    "dont4": "Don't ignore the waiting period for specific ailments.",
    "dont5": "Don't overshoot the Room Rent Limit (it triggers pro-rata deduction).",
    "lifeDo1": "Disclose all previous insurance policies and any rejections.",
    "lifeDo2": "Accurately mention your income to ensure adequate human life value coverage.",
    "lifeDo3": "Clearly state your smoking and drinking habits (be honest).",
    "lifeDo4": "Update your nominee details if you get married or have children.",
    "lifeDo5": "Check the policy bond for correct Sum Assured and Nominee name within Free Look period.",
    "lifeDont1": "Don't let the agent fill the form for you without verifying each field.",
    "lifeDont2": "Don't hide any history of hereditary diseases in the family.",
    "lifeDont3": "Don't ignore the waiting period for suicidal death claims (usually 1 year).",
    "lifeDont4": "Don't sign a blank proposal form under any circumstances.",
    "lifeDont5": "Don't miss checking the policy status every year - keep the premium paid."
  },
  "Hindi": {
    "explore": "पॉलिसी एक्सप्लोरर",
    "compare": "तुलना करें",
    "recommend": "सिफारिशें",
    "assistant": "AI सहायक",
    "heroTitle": "अपनी स्वास्थ्य सुरक्षा को सरल बनाएं",
    "heroSub": "बिना किसी कठिन शब्दों के भारतीय स्वास्थ्य बीमा पॉलिसियों की तुलना करें।",
    "hospitals": "अस्पताल",
    "premium": "अनुमानित प्रीमियम",
    "explain": "बारीकियां समझें",
    "back": "वापस",
    "feature": "विशेषता",
    "gist": "सारांश",
    "verdict": "AI फैसला",
    "nuances": "बारीकियां और विवरण",
    "criticalExclusionsHead": "महत्वपूर्ण बहिष्करण",
    "profileTitle": "आपकी प्रोफाइल",
    "age": "आयु",
    "maritalStatus": "वैवाहिक स्थिति",
    "single": "अविवाहित",
    "married": "विवाहित",
    "widow": "विधवा/विधुर",
    "divorced": "तलाकशुदा",
    "ped": "पुरानी बीमारियाँ",
    "gender": "लिंग",
    "city": "शहर",
    "lifestyle": "जीवनशैली",
    "smoking": "धूम्रपान",
    "drinking": "शराब पीना",
    "surgery": "सर्जरी का इतिहास",
    "medication": "दवाओं का सेवन",
    "thyroid": "थायराइड",
    "none": "कोई नहीं",
    "generate": "सिफारिश प्राप्त करें",
    "topMatches": "सर्वश्रेष्ठ विकल्प",
    "scenario": "स्थिति / प्रश्न",
    "placeholder": "उदा: 'मुझे मधुमेह है। क्या इसमें इंसुलिन कवर होता है?'",
    "simplify": "शब्दों को सरल बनाएं",
    "yearsInBusiness": "व्यवसाय में वर्ष",
    "activeCustomers": "सक्रिय ग्राहक",
    "policiesSold": "बिकी हुई पॉलिसियाँ / वर्ष",
    "rejectionRate": "दावा अस्वीकृति",
    "complaints": "शिकायतें / 10 हजार",
    "last5Years": "IRDAI प्रदर्शन (5 वर्ष)",
    "about": "बीमा कंपनी के बारे में",
    "close": "बंद करें",
    "knowYourPolicy": "अपनी पॉलिसी जानें",
    "knowYourPolicyDesc": "विस्तार से समझने के लिए अपनी पॉलिसी अपलोड करें",
    "processing": "विश्लेषण किया जा रहा है...",
    "keyTerms": "मुख्य शर्तें",
    "policyExclusions": "बहिष्करण (Exclusions)",
    "limitations": "सीमाएँ (Limitations)",
    "uploadPrompt": "पीडीएफ अपलोड करें",
    "analysisComplete": "विश्लेषण पूरा हुआ",
    "previousAnalyses": "पिछले विश्लेषण",
    "compliance": "IRDAI अनुपालन",
    "claims": "दावे और अनुपालन",
    "claimDesc": "समझें कि आपका दावा क्यों खारिज हुआ और IRDAI कानूनों के तहत इसे कैसे लड़ें।",
    "rejectionReason": "अस्वीकृति का कारण",
    "rejectionPlaceholder": "उदा: 'हर्निया के लिए 2 साल की प्रतीक्षा अवधि के कारण दावा खारिज'",
    "checkCompliance": "अनुपालन जांचें",
    "stepsToFight": "समाधान के चरण",
    "caseStudy": "सफल मामला",
    "irdaiComplaint": "IRDAI बीमा भरोसा",
    "complianceRules": "प्रासंगिक IRDAI नियम",
    "rejectionEmptyState": "अपनी अस्वीकृति का विवरण दर्ज करें ताकि हम रिपोर्ट तैयार कर सकें।",
    "visitPortal": "पोर्टल पर जाएं",
    "officialResource": "आधिकारिक संसाधन",
    "rejectionAssessment": "अस्वीकृति",
    "summary": "सारांश",
    "premiumRange": "प्रीमियम रेंज",
    "hospitalNetworks": "नेटवर्क अस्पताल",
    "roomRent": "रूम रेंट सीमा",
    "waitingPeriod": "प्रतीक्षा अवधि (PED)",
    "coPay": "को-पेमेंट",
    "preHosp": "अस्पताल में भर्ती होने से पहले का खर्च",
    "postHosp": "डिस्चार्ज के बाद का खर्च",
    "dayCare": "डे केयर",
    "domiciliary": "घर पर इलाज",
    "ambulance": "एम्बुलेंस",
    "nonConsumables": "नॉन-कंज्यूमेबल्स",
    "renewalDiscount": "नो क्लेम बोनस",
    "opd": "OPD कवर",
    "ayush": "आयुष (AYUSH)",
    "organDonor": "अंग दाता खर्च",
    "whyRecommended": "सिफारिश क्यों की गई?",
    "insurerTrust": "बीमा कंपनी का भरोसा और साख",
    "costValue": "लागत और मूल्य",
    "howItCompares": "यह तुलना में कैसा है",
    "keyBenefit": "आपके लिए मुख्य लाभ",
    "exploreDetails": "विवरण देखें",
    "auditScore": "ऑडिट स्कोर",
    "basedOnIrdai": "IRDAI 2024 मास्टर सर्कुलर के आधार पर",
    "findingsDeviations": "निष्कर्ष और विचलन",
    "grayAreas": "अस्पष्ट क्षेत्र / संदेह",
    "proTip": "प्रो-टिप: ये अस्पष्ट क्षेत्र अक्सर दावों को खारिज करने के लिए उपयोग किए जाते हैं।",
    "compliant": "अनुपालन",
    "nonCompliant": "अनुपालन नहीं",
    "partialCompliant": "आंशिक अनुपालन",
    "rejection": "अस्वीकृति",
    "skip": "छोड़ें",
    "planType": "योजना का प्रकार",
    "sumAssured": "बीमा राशि",
    "whatWorksBetter": "क्या आपके लिए बेहतर है?",
    "strategyComparison": "रणनीति तुलना",
    "maturity": "परिपक्वता लाभ",
    "deathCover": "कुल मृत्यु कवर",
    "termFdStrategy": "टर्म बीमा + FD/बॉन्ड रणनीति",
    "termMfStrategy": "टर्म बीमा + इंडेक्स फंड रणनीति",
    "maturityBenefit": "परिपक्वता लाभ",
    "deathBenefit": "मृत्यु लाभ",
    "policyTerm": "पॉलिसी की अवधि",
    "premiumTerm": "प्रीमियम भुगतान की अवधि",
    "riders": "राइडर्स / अतिरिक्त लाभ",
    "morbidityBenefit": "रुग्णता लाभ",
    "maturityPayout": "परिपक्वता भुगतान",
    "estIrr": "अनुमानित IRR",
    "hideComparison": "तुलना छिपाएं",
    "annualSplit": "वार्षिक विभाजन",
    "estMaturity": "अनुमानित परिपक्वता",
    "deathLifeCover": "लाइफ कवर (मृत्यु)",
    "flexibility": "लचीलापन",
    "fullToInsurer": "पूरी राशि बीमा कंपनी को",
    "buyTermInvestDiff": "टर्म बीमा लें और अंतर निवेश करें",
    "splitPremiumAdvise_part1": "अपने",
    "splitPremiumAdvise_part2": "प्रीमियम को विभाजित करें ताकि आपको 10 गुना अधिक कवर और बेहतर लाभ मिल सके।",
    "proTipStrategy": "प्रो टिप: पारंपरिक 'बचत' बीमा योजनाएं अक्सर कम कवर के साथ 5-6% रिटर्न देती हैं। अपने बीमा (शुद्ध टर्म) और अपने निवेश (FD/MF) को अलग रखने से आपको उसी बजट में बेहतर सुरक्षा और अधिक धन वृद्धि मिलती है।",
    "termFd7": "टर्म बीमा + FD (7%)",
    "termMf12": "टर्म बीमा + MF (12%)",
    "termMf10": "टर्म बीमा + MF (10%)",
    "traditional": "पारंपरिक",
    "timePeriod": "समयावधि",
    "termPremiumTitle": "टर्म प्रीमियम (1 करोड़ कवर)",
    "lockedLow": "लॉक (कम)",
    "fullPartial": "पूर्ण (आंशिक)",
    "highFlex": "उच्च लचीलापन",
    "comparisonMetric": "तुलना का मानक",
    "netGain": "शुद्ध लाभ (प्रीमियम से अधिक)",
    "totalPremiumPaid": "कुल भुगतान किया गया प्रीमियम",
    "payoutAnalysis": "भुगतान विश्लेषण",
    "event": "घटना",
    "benefitType": "लाभ का प्रकार",
    "amount": "राशि",
    "zeroProtection": "शुद्ध (केवल सुरक्षा)",
    "returnsCalc": "रिटर्न कैलकुलेटर",
    "xirr": "एक्सआईआरआर (XIRR)",
    "cagr": "सीएजीआर (CAGR)",
    "selectRiders": "राइडर्स चुनें",
    "totalPremium": "कुल प्रीमियम",
    "compoundedAnnually": "वार्षिक चक्रवृद्धि",
    "comparisonTable": "पॉलिसी तुलना तालिका",
    "currentAge": "आपकी वर्तमान आयु",
    "yes": "हाँ",
    "no": "नहीं",
    "smoker": "धूम्रपान करने वाले?",
    "expertVerdict": "विशेषज्ञ फैसला",
    "illustrativeNotice": "सभी मान मानक उद्योग धारणाओं पर आधारित उदाहरणात्मक हैं।",
    "clearSelections": "चयन साफ करें",
    "pureProtectionDesc": "यह एक शुद्ध सुरक्षा योजना है। प्रत्येक रुपया एक विशाल जीवन कवर खरीदने की ओर जाता है। पारिवारिक सुरक्षा के लिए उच्च दक्षता।",
    "savingsMaturityDesc": "{age} वर्ष की आयु में, आप {years} वर्षों के लिए भुगतान करते हैं। CAGR लगभग {cagr}% है। कम जोखिम वाले दीर्घकालिक लक्ष्यों के लिए अच्छा है।",
    "policyEnd": "पॉलिसी की समाप्ति",
    "maturitySurvival": "परिपक्वता / उत्तरजीविता",
    "deathBenefitLabel": "मृत्यु लाभ",
    "deathImmediate": "मृत्यु (तत्काल)",
    "morbidity": "रुग्णता",
    "disabilityCritical": "विकलांगता / गंभीर बीमारी",
    "plan": "योजना",
    "avoidRejectionHead": "दावा खारिज होने से कैसे बचें",
    "dos": "क्या करें",
    "donts": "क्या न करें",
    "trustScore": "ट्रस्ट स्कोर",
    "summaryDashboard": "सारांश डैशबोर्ड",
    "lessData": "कम डेटा",
    "detailedView": "विस्तृत दृश्य",
    "experience": "अनुभव",
    "trustIndex": "ट्रस्ट इंडेक्स",
    "whyDenied": "दावे क्यों खारिज होते हैं",
    "dosButton": "दावा खारिज होने से बचने के उपाय",
    "do1": "खरीदते समय हमेशा पहले से मौजूद बीमारियों (PED) का खुलासा करें।",
    "do2": "यदि कवर नहीं किया गया है तो उपभोग्य वस्तुओं (consumables) के लिए सीधे अस्पतालों को भुगतान करें।",
    "do3": "जांचें कि क्या अस्पताल बीमाकर्ता की नेटवर्क सूची में है।",
    "do4": "सभी मूल बिल और डिस्चार्ज सारांश जमा करें।",
    "do5": "आपातकालीन अस्पताल में भर्ती होने के 24-48 घंटों के भीतर बीमाकर्ता को सूचित करें।",
    "dont1": "केवल एजेंट के मौखिक वादों पर भरोसा न करें।",
    "dont2": "सर्जरी के इतिहास या धूम्रपान जैसी जीवनशैली की आदतों को न छिपाएं।",
    "dont3": "प्री-ऑथ प्रक्रिया शुरू करने के लिए डिस्चार्ज होने का इंतज़ार न करें।",
    "dont4": "विशिष्ट बीमारियों के लिए प्रतीक्षा अवधि को नजरअंदाज न करें।",
    "dont5": "Don't overshoot the Room Rent Limit (it triggers pro-rata deduction).",
    "lifeDo1": "बीमे की पिछली सभी पॉलिसियों और अस्वीकृति का विवरण दें।",
    "lifeDo2": "अपनी आय का सही उल्लेख करें ताकि पर्याप्त जीवन मूल्य कवर सुनिश्चित हो सके।",
    "lifeDo3": "धूम्रपान और शराब पीने की आदतों का सही विवरण दें (ईमानदार रहें)।",
    "lifeDo4": "यदि आप शादी करते हैं या बच्चे होते हैं तो नॉमिनी विवरण अपडेट करें।",
    "lifeDo5": "फ्री लुक पीरियड के भीतर सही बीमा राशि और नॉमिनी के नाम के लिए पॉलिसी बॉन्ड की जांच करें।",
    "lifeDont1": "प्रस्ताव पत्र (proposal form) को बिना क्रॉस-चेक किए एजेंट को न भरने दें।",
    "lifeDont2": "परिवार में वंशानुगत बीमारियों के किसी भी इतिहास को न छिपाएं।",
    "lifeDont3": "आत्महत्या से मृत्यु के दावों (आमतौर पर 1 वर्ष) के लिए प्रतीक्षा अवधि को नजरअंदाज न करें।",
    "lifeDont4": "किसी भी परिस्थिति में कोरे प्रस्ताव पत्र पर हस्ताक्षर न करें।",
    "lifeDont5": "हर साल पॉलिसी की स्थिति की जांच करना न भूलें - प्रीमियम का भुगतान समय पर करें।"
  },
  "Kannada": {
    "explore": "ಪಾಲಿಸಿ ಎಕ್ಸ್‌ಪ್ಲೋರರ್",
    "compare": "ಹೋಲಿಕೆ ಮಾಡಿ",
    "recommend": "ಶಿಫಾರಸುಗಳು",
    "assistant": "விಮಾ ಸಹಾಯಕ",
    "heroTitle": "ನಿಮ್ಮ ಆರೋಗ್ಯ ಭದ್ರತೆಯನ್ನು ಸರಳಗೊಳಿಸಿ",
    "heroSub": "ಕಠಿಣ ಪದಗಳಿಲ್ಲದೆ ಭಾರತೀಯ ಆರೋಗ್ಯ ವಿಮಾ ಪಾಲಿಸಿಗಳನ್ನು ಹೋಲಿಕೆ ಮಾಡಿ.",
    "hospitals": "ಆಸ್ಪತ್ರೆಗಳು",
    "premium": "ಅಂದಾಜು ಪ್ರೀಮಿಯಂ",
    "explain": "ವಿವರಗಳನ್ನು ತಿಳಿಯಿರಿ",
    "back": "ಹಿಂದಕ್ಕೆ",
    "feature": "ವೈಶಿಷ್ಟ್ಯ",
    "gist": "ಸಾರಾಂಶ",
    "verdict": "ತರ್ಕಬದ್ಧ ನಿರ್ಧಾರ",
    "nuances": "ಸೂಕ್ಷ್ಮ ವಿವರಗಳು",
    "criticalExclusionsHead": "ಪ್ರಮುಖ ಹೊರಗಿಡುವಿಕೆಗಳು",
    "profileTitle": "ನಿಮ್ಮ ಪ್ರೊಫೈಲ್",
    "age": "ವಯಸ್ಸು",
    "maritalStatus": "ವೈವಾಹಿಕ ಸ್ಥಿತಿ",
    "single": "ಒಂಟಿ",
    "married": "ವಿವಾಹಿತ",
    "widow": "ವಿಧವೆ/ವಿಧುರ",
    "divorced": "ವಿಚ್ಛೇದಿತ",
    "ped": "ಹಳೆಯ ಕಾಯಿಲೆಗಳು",
    "gender": "ಲಿಂಗ",
    "city": "ನಗರ",
    "lifestyle": "ಜೀವನಶೈಲಿ",
    "smoking": "ಧೂಮಪಾನ",
    "drinking": "ಮದ್ಯಪಾನ",
    "surgery": "ಸರ್ಜರಿ ಇತಿಹಾಸ",
    "medication": "ಔಷಧಿ ಸೇವನೆ",
    "thyroid": "ಥೈರಾಯ್ಡ್",
    "none": "ಯಾವುದೂ ಇಲ್ಲ",
    "generate": "ಶಿಫಾರಸು ಪಡೆಯಿರಿ",
    "topMatches": "ಅತ್ಯುತ್ತಮ ಆಯ್ಕೆಗಳು",
    "scenario": "ಸಂದರ್ಭ / ಪ್ರಶ್ನೆ",
    "placeholder": "ಉದಾ: 'ನನಗೆ ಸಕ್ಕರೆ ಕಾಯಿಲೆ ಇದೆ. ಇದು ಇನ್ಸುಲಿನ್ ಅನ್ನು ಒಳಗೊಳ್ಳುತ್ತದೆಯೇ?'",
    "simplify": "ಪದಗಳನ್ನು ಸರಳಗೊಳಿಸಿ",
    "yearsInBusiness": "ವ್ಯವಹಾರದಲ್ಲಿನ ವರ್ಷಗಳು",
    "activeCustomers": "ಸಕ್ರಿಯ ಗ್ರಾಹಕರು",
    "policiesSold": "ಮಾರಾಟವಾದ ಪಾಲಿಸಿಗಳು / ವರ್ಷ",
    "rejectionRate": "ಕ್ಲೈಮ್ ತಿರಸ್ಕಾರ",
    "complaints": "ದೂರುಗಳು / 10 ಸಾವಿರಕ್ಕೆ",
    "last5Years": "IRDAI ಸಾಧನೆ (5 ವರ್ಷ)",
    "about": "ವಿಮಾದಾರರ ಬಗ್ಗೆ",
    "close": "ಮುಚ್ಚಿ",
    "knowYourPolicy": "ನಿಮ್ಮ ಪಾಲಿಸಿಯನ್ನು ತಿಳಿಯಿರಿ",
    "knowYourPolicyDesc": "ವಿವರವಾಗಿ ಅರ್ಥಮಾಡಿಕೊಳ್ಳಲು ನಿಮ್ಮ ಪಾಲಿಸಿಯನ್ನು ಅಪ್‌ಲೋಡ್ ಮಾಡಿ",
    "processing": "ವಿಶ್ಲೇಷಿಸಲಾಗುತ್ತಿದೆ...",
    "keyTerms": "ಪ್ರಮುಖ ನಿಯಮಗಳು",
    "policyExclusions": "ಹೊರಗಿಡುವಿಕೆಗಳು",
    "limitations": "ಮಿತಿಗಳು",
    "uploadPrompt": "ಪಿಡಿಎಫ್ ಅಪ್‌ಲೋಡ್ ಮಾಡಿ",
    "analysisComplete": "ವಿಶ್ಲೇಷಣೆ ಪೂರ್ಣಗೊಂಡಿದೆ",
    "previousAnalyses": "ಹಿಂದಿನ ವಿಶ್ಲೇಷಣೆಗಳು",
    "compliance": "IRDAI ಅನುಸರಣೆ",
    "claims": "ಕ್ಲೈಮ್‌ಗಳು ಮತ್ತು ಅನುಸರಣೆ",
    "claimDesc": "ನಿಮ್ಮ ಕ್ಲೈಮ್ ಏಕಾಗಿ ತಿರಸ್ಕರಿಸಲ್ಪಟ್ಟಿತು ಮತ್ತು IRDAI ನಿಯಮಗಳ ಪ್ರಕಾರ ಅದನ್ನು ಹೇಗೆ ಎದುರಿಸಬೇಕೆಂದು ತಿಳಿಯಿರಿ.",
    "rejectionReason": "ತಿರಸ್ಕಾರಕ್ಕೆ ಕಾರಣ",
    "rejectionPlaceholder": "ಉದಾ: 'ಹರ್ನಿಯಾಗೆ 2 ವರ್ಷಗಳ ಕಾಯುವ ಅವಧಿಯ ಕಾರಣ ಕ್ಲೈಮ್ ತಿರಸ್ಕರಿಸಲಾಗಿದೆ'",
    "checkCompliance": "ಅನುಸರಣೆಯನ್ನು ಪರಿಶೀಲಿಸಿ",
    "stepsToFight": "ಪರಿಹಾರದ ಹಂತಗಳು",
    "caseStudy": "ಯಶಸ್ವಿ ವಿವಾದ ಪ್ರಕರಣ",
    "irdaiComplaint": "IRDAI ಬಿಮಾ ಭರೋಸಾ",
    "complianceRules": "ಸಂಬಂಧಿತ IRDAI ನಿಯಮಗಳು",
    "amount": "ರಕಂ",
    "zeroProtection": "ಶೂನ್ಯ (ರಕ್ಷಣೆ ಮಾತ್ರ)",
    "returnsCalc": "ರಿಟರ್ನ್ಸ್ ಕ್ಯಾಲಿಕ್ಯುಲೇಟರ್",
    "xirr": "XIRR",
    "cagr": "CAGR",
    "riders": "ರೈಡರ್‌ಗಳು",
    "selectRiders": "ರೈಡರ್‌ಗಳನ್ನು ಆಯ್ಕೆಮಾಡಿ",
    "totalPremium": "ಒಟ್ಟು ಪ್ರೀಮಿಯಂ",
    "compoundedAnnually": "ವಾರ್ಷಿಕವಾಗಿ ಸಂಯೋಜಿಸಲಾಗಿದೆ",
    "comparisonTable": "ಪಾಲಿಸಿ ಹೋಲಿಕೆ ಕೋಷ್ಟಕ",
    "currentAge": "ನಿಮ್ಮ ಪ್ರಸ್ತುತ ವಯಸ್ಸು",
    "yes": "ಹೌದು",
    "no": "ಇಲ್ಲ",
    "smoker": "ಧೂಮಪಾನಿಯೇ?",
    "expertVerdict": "ತಜ್ಞರ ತೀರ್ಪು",
    "illustrativeNotice": "ಎಲ್ಲಾ ಮೌಲ್ಯಗಳು ಪ್ರಮಾಣಿತ ಉದ್ಯಮದ ಊಹೆಗಳನ್ನು ಆಧರಿಸಿವೆ.",
    "clearSelections": "ಆಯ್ಕೆಗಳನ್ನು ತೆರವುಗೊಳಿಸಿ",
    "pureProtectionDesc": "ಇದು ಶುದ್ಧ ರಕ್ಷಣೆ ಯೋಜನೆ. ಪ್ರತಿಯೊಂದು ರೂಪಾಯಿಯು ದೊಡ್ಡ ಜೀವ ವಿಮೆಯನ್ನು ಖರೀದಿಸಲು ಹೋಗುತ್ತದೆ. ಕುಟುಂಬ ಭದ್ರತೆಗಾಗಿ ಉತ್ತಮವಾಗಿದೆ.",
    "savingsMaturityDesc": "{age} ವಯಸ್ಸಿನಲ್ಲಿ, ನೀವು {years} ವರ್ಷಗಳವರೆಗೆ ಪಾವತಿಸುತ್ತೀರಿ. CAGR ಸುಮಾರು {cagr}% ಇರುತ್ತದೆ. ಕಡಿಮೆ ಅಪಾಯದ ದೀರ್ಘಕಾಲೀನ ಗುರಿಗಳಿಗೆ ಉತ್ತಮವಾಗಿದೆ.",
    "policyEnd": "ಪಾಲಿಸಿ ಅಂತ್ಯ",
    "maturitySurvival": "ಪಕ್ವತೆ / ಬದುಕುಳಿಯುವಿಕೆ",
    "deathBenefitLabel": "ಮರಣ ಪ್ರಯೋಜನ",
    "deathImmediate": "ಮರಣ (ತಕ್ಷಣ)",
    "morbidity": "ಅನಾರೋಗ್ಯ",
    "disabilityCritical": "ಅಂಗವೈಕಲ್ಯ / ಗಂಭೀರ ಕಾಯಿಲೆ",
    "plan": "ಯೋಜನೆ",
    "avoidRejectionHead": "ಕ್ಲೈಮ್ ತಿರಸ್ಕಾರವನ್ನು ತಪ್ಪಿಸುವುದು ಹೇಗೆ",
    "dos": "ಮಾಡಬೇಕಾದವುಗಳು",
    "donts": "ಮಾಡಬಾರದವುಗಳು",
    "trustScore": "ನಂಬಿಕೆ ಸ್ಕೋರ್",
    "summaryDashboard": "ಸಾರಾಂಶ ಡ್ಯಾಶ್‌ಬೋರ್ಡ್",
    "lessData": "ಕಡಿಮೆ ಡೇಟಾ",
    "detailedView": "ವಿವರವಾದ ದೃಷ್ಟಿಕೋನ",
    "dosButton": "ಕ್ಲೈಮ್ ತಿರಸ್ಕಾರವನ್ನು ತಪ್ಪಿಸುವ ಉಪಾಯಗಳು",
    "lifeDo1": "ಹಿಂದಿನ ಎಲ್ಲಾ ವಿಮಾ ಪಾಲಿಸಿಗಳು ಮತ್ತು ಯಾವುದೇ ತಿರಸ್ಕಾರಗಳ ಬಗ್ಗೆ ಮಾಹಿತಿ ನೀಡಿ.",
    "lifeDo2": "ಪೂರ್ಣ ಜೀವನ ಮೌಲ್ಯದ ಕವರೇಜ್ ಖಚಿತಪಡಿಸಿಕೊಳ್ಳಲು ನಿಮ್ಮ ಆದಾಯವನ್ನು ಸರಿಯಾಗಿ ತಿಳಿಸಿ.",
    "lifeDo3": "ನಿಮ್ಮ ಧೂಮಪಾನ ಮತ್ತು ಮದ್ಯಪಾನದ ಅಭ್ಯಾಸಗಳನ್ನು ಪ್ರಾಮಾಣಿಕವಾಗಿ ತಿಳಿಸಿ.",
    "lifeDo4": "ನಿಮಗೆ ಮದುವೆಯಾದರೆ ಅಥವಾ ಮಕ್ಕಳಾದರೆ ನಾಮಿನಿ ವಿವರಗಳನ್ನು ಅಪ್‌ಡೇಟ್ ಮಾಡಿ.",
    "lifeDo5": "ಫ್ರೀ ಲುಕ್ ಅವಧಿಯೊಳಗೆ ಸರಿಯಾದ ವಿಮಾ ಮೊತ್ತ ಮತ್ತು ನಾಮಿನಿ ಹೆಸರಿಗಾಗಿ ಪಾಲಿಸಿ ಬಾಂಡ್ ಪರಿಶೀಲಿಸಿ.",
    "lifeDont1": "ಪ್ರತಿಯೊಂದು ಕಾಲಂ ಅನ್ನು ಪರಿಶೀಲಿಸದೆ ಏಜೆಂಟ್‌ಗೆ ಫಾರ್ಮ್ ತುಂಬಲು ಬಿಡಬೇಡಿ.",
    "lifeDont2": "ಕುಟುಂಬದಲ್ಲಿ ಯಾವುದೇ ಅನುವಂಶಿಕ ಕಾಯಿಲೆಗಳ ಇತಿಹಾಸವಿದ್ದರೆ ಅದನ್ನು ಮರೆಮಾಡಬೇಡಿ.",
    "lifeDont3": "ಆತ್ಮಹತ್ಯೆ ಸಾವುಗಳ ಕ್ಲೈಮ್‌ಗಳಿಗೆ (ಸಾಮಾನ್ಯವಾಗಿ 1 ವರ್ಷ) ಕಾಯುವ ಅವಧಿಯನ್ನು ನಿರ್ಲಕ್ಷಿಸಬೇಡಿ.",
    "lifeDont4": "ಯಾವುದೇ ಸಂದರ್ಭದಲ್ಲೂ ಖಾಲಿ ಪ್ರಪೋಸಲ್ ಫಾರ್ಮ್‌ಗೆ ಸಹಿ ಮಾಡಬೇಡಿ.",
    "lifeDont5": "ಪ್ರತಿ ವರ್ಷ ಪಾಲಿಸಿ ಸ್ಥಿತಿಯನ್ನು ಪರೀಕ್ಷಿಸಲು ಮರೆಯಬೇಡಿ - ಪ್ರೀಮಿಯಂ ಸಮಯಕ್ಕೆ ಪಾವತಿಸಿ."
  },
  "Telugu": {
    "explore": "పాలసీ ఎక్స్‌ప్లోరర్",
    "compare": "పోల్చండి",
    "recommend": "సిఫార్సులు",
    "assistant": "వీమా సహాయకుడు",
    "heroTitle": "మీ ఆరోగ్య భద్రతను సరళీకరించండి",
    "heroSub": "క్లిష్టమైన పదాలు లేకుండా భారతీయ ఆరోగ్య బీమా పాలసీలను పోల్చండి.",
    "hospitals": "ఆసుపత్రులు",
    "premium": "అంచనా ప్రీమియం",
    "explain": "వివరాలను అర్థం చేసుకోండి",
    "back": "వెనుకకు",
    "feature": "ఫీచర్",
    "gist": "సారాంశం",
    "verdict": "AI తీర్పు",
    "nuances": "సూక్ష్మ వివరాలు",
    "criticalExclusionsHead": "ముఖ్యమైన మినహాయింపులు",
    "profileTitle": "మీ ప్రొఫైల్",
    "age": "వయస్సు",
    "maritalStatus": "వైవాహిక స్థితి",
    "single": "ఒంటరి",
    "married": "వివాహం",
    "widow": "విధవ/విదురుడు",
    "divorced": "విడాకులు తీసుకున్న",
    "ped": "మునుపటి అనారోగ్యాలు",
    "gender": "లింగం",
    "city": "నగరం",
    "lifestyle": "జీవనశైలి",
    "smoking": "ధూమపానం",
    "drinking": "మద్యపానం",
    "surgery": "సర్జరీ చరిత్ర",
    "medication": "మందుల వాడకం",
    "thyroid": "థైరాయిడ్",
    "none": "ఏమీ లేదు",
    "generate": "సిఫార్సును పొందండి",
    "topMatches": "ఉత్తమ ఎంపికలు",
    "scenario": "సందర్భం / ప్రశ్న",
    "placeholder": "ఉదా: 'నాకు షుగర్ ఉంది. ఇది ఇన్సులిన్‌ను కవర్ చేస్తుందా?'",
    "simplify": "నిబంధనలను సులభతరం చేయండి",
    "yearsInBusiness": "వ్యాపారంలో సంవత్సరాలు",
    "activeCustomers": "క్లిష్టమైన కస్టమర్లు",
    "policiesSold": "అమ్మబడిన పాలసీలు / సంవత్సరం",
    "rejectionRate": "క్లెయిమ్ తిరస్కరణ",
    "complaints": "ఫిర్యాదులు / 10 వేల మందికి",
    "last5Years": "IRDAI పనితీరు (5 సం||)",
    "about": "భీమా సంస్థ గురించి",
    "close": "మూసివేయి",
    "knowYourPolicy": "పాలసీని తెలుసుకోండి",
    "knowYourPolicyDesc": "వివరంగా అర్థం చేసుకోవడానికి పాలసీని అప్‌లోడ్ చేయండి",
    "processing": "విశ్లేషిస్తోంది...",
    "keyTerms": "ప్రధాన నిబంధనలు",
    "policyExclusions": "మినహాయింపులు",
    "limitations": "పరిమితులు",
    "uploadPrompt": "పిడిఎఫ్ అప్‌లోడ్ చేయండి",
    "analysisComplete": "విశ్లేషణ పూర్తయింది",
    "previousAnalyses": "మునుపటి విశ్లేషణలు",
    "compliance": "IRDAI నిబంధనలు",
    "claims": "క్లెయిమ్స్ & నిబంధనలు",
    "claimDesc": "IRDAI చట్టాల ప్రకారం మీ క్లెయిమ్ ఎందుకు తిరస్కరించబడింది మరియు ఎలా పోరాడాలో అర్థం చేసుకోండి.",
    "rejectionReason": "తిరస్కరణకు కారణం",
    "rejectionPlaceholder": "ఉదా: 'హెర్నియా కోసం 2 ఏళ్ల వెయిటింగ్ పీరియడ్ వల్ల క్లెయిమ్ తిరస్కరించబడింది'",
    "checkCompliance": "నిబంధనలను తనిఖీ చేయండి",
    "stepsToFight": "పరిష్కార దశలు",
    "caseStudy": "విజయవంతమైన వివాద కేసు",
    "irdaiComplaint": "IRDAI భీమా భరోసా",
    "complianceRules": "సంబంధిత IRDAI నియమాలు",
    "rejectionEmptyState": "వివరాలను నమోదు చేయండి.",
    "visitPortal": "పోర్టల్‌ను సందర్శించండి",
    "officialResource": "అధికారిక వనరు",
    "rejectionAssessment": "తిరస్కరణ",
    "summary": "సారాంశం",
    "premiumRange": "ప్రీమియం పరిధి",
    "hospitalNetworks": "నెట్‌వర్క్ ఆసుపత్రులు",
    "roomRent": "గది అద్దె పరిమితి",
    "waitingPeriod": "వెయిటింగ్ పీరియడ్ (PED)",
    "coPay": "కో-పేమెంట్",
    "preHosp": "ఆసుపత్రిలో చేరడానికి ముందు ఖర్చులు",
    "postHosp": "డిశ్చార్జ్ తర్వాత ఖర్చులు",
    "dayCare": "డే కేర్",
    "domiciliary": "ఇంటి వద్ద చికిత్స",
    "ambulance": "అంబులెన్స్",
    "nonConsumables": "వాడకంలో లేని వస్తువులు",
    "renewalDiscount": "నో క్లెయిమ్ బోనస్",
    "opd": "OPD కవరేజ్",
    "ayush": "ఆయుష్ (AYUSH)",
    "organDonor": "అవయవ దాత ఖర్చులు",
    "whyRecommended": "ఎందుకు సిఫార్సు చేయబడింది?",
    "insurerTrust": "భీమా సంస్థ నమ్మకం & ప్రతిష్ట",
    "costValue": "ఖర్చు & విలువ",
    "howItCompares": "ఇది ఎలా పోలుస్తుంది",
    "keyBenefit": "మీ కోసం ప్రధాన ప్రయోజనం",
    "exploreDetails": "వివరాలను అన్వేషించండి",
    "auditScore": "ఆడిట్ స్కోరు",
    "basedOnIrdai": "IRDAI 2024 మాస్టర్ సర్క్యులర్ల ఆధారంగా",
    "findingsDeviations": "కనుగొన్నవి & వ్యత్యాసాలు",
    "grayAreas": "అస్పష్ట ప్రాంతాలు / సందిగ్ధతలు",
    "proTip": "ప్రో-టిప్: ఈ ప్రాంతాలను భీమా సంస్థతో స్పష్టం చేసుకోండి.",
    "compliant": "అనుగుణంగా ఉంది",
    "nonCompliant": "అనుగుణంగా లేదు",
    "partialCompliant": "పాక్షికంగా అనుగుణంగా ఉంది",
    "rejection": "తిరస్కరణ",
    "skip": "వదిలేయండి",
    "planType": "ప్లాన్ రకం",
    "sumAssured": "భీమా మొత్తం",
    "whatWorksBetter": "ఏది మీకు మేలు చేస్తోంది?",
    "strategyComparison": "వ్యూహం పోలిక",
    "maturity": "మెచ్యూరిటీ బెనిఫిట్స్",
    "deathCover": "మొత్తం డెత్ కవర్",
    "termFdStrategy": "టర్మ్ ఇన్యూరెన్స్ + FD/బాండ్",
    "termMfStrategy": "టర్మ్ ఇన్యూరెన్స్ + ఇండెక్స్ MF",
    "maturityBenefit": "మెచ్యూరిటీ బెనిఫిట్",
    "deathBenefit": "డెత్ బెనిఫిట్",
    "policyTerm": "పాలసీ వ్యవధి",
    "premiumTerm": "ప్రీమియం వ్యవధి",
    "riders": "రైడర్స్",
    "morbidityBenefit": "రుగ్మత ప్రయోజనం",
    "maturityPayout": "మెచ్యూరిటీ చెల్లింపు",
    "estIrr": "అంచనా IRR",
    "hideComparison": "పోలికను దాచు",
    "annualSplit": "వార్షిక విభజన",
    "estMaturity": "అంచనా మెచ్యూరిటీ",
    "deathLifeCover": "లైఫ్ కవర్ (డెత్)",
    "flexibility": "ఫ్లెక్సిబిలిటీ",
    "fullToInsurer": "మొత్తం ఇన్సూరర్‌కు",
    "buyTermInvestDiff": "టర్మ్ ఇన్సూరెన్స్ కొని మిగిలినది ఇన్వెస్ట్ చేయండి",
    "splitPremiumAdvise_part1": "మీ",
    "splitPremiumAdvise_part2": "ప్రీమియంను 10 రెట్లు ఎక్కువ కవర్ మరియు మెరుగైన రిటర్న్స్ కోసం విభజించండి.",
    "proTipStrategy": "ప్రో టిప్: సాంప్రదాయ 'పొదుపు' ఇన్సూరెన్స్ ప్లాన్లు తరచుగా తక్కువ కవర్‌తో 5-6% రాబడిని ఇస్తాయి. మీ ఇన్సూరెన్స్ (ప్యూర్ టర్మ్) మరియు మీ ఇన్వెస్ట్‌మెంట్లను (FD/MF) విడదీయడం వల్ల మీకు మెరుగైన రక్షణ మరియు అధిక సంపద వృద్ధి లభిస్తుంది.",
    "termFd7": "టర్మ్ + FD (7%)",
    "termMf12": "టర్మ్ + MF (12%)",
    "lockedLow": "లాక్ చేయబడింది (తక్కువ)",
    "fullPartial": "పూర్తి (పాక్షిక)",
    "highFlex": "హై ఫ్లెక్స్",
    "comparisonMetric": "పోలిక ప్రమాణం",
    "netGain": "నికర లాభం (ప్రీమియం కంటే ఎక్కువ)",
    "totalPremiumPaid": "మొత్తం చెల్లించిన ప్రీమియం",
    "payoutAnalysis": "చెల్లింపు విశ్లేషణ",
    "event": "సందర్భం",
    "benefitType": "ప్రయోజనం రకం",
    "amount": "మొత్తం",
    "zeroProtection": "సున్నా (కేవలం రక్షణ)",
    "returnsCalc": "రిటర్న్స్ క్యాలిక్యులేటర్",
    "currentAge": "మీ ప్రస్తుత వయస్సు",
    "yes": "అవును",
    "no": "కాదు",
    "smoker": "పొగతాగే అలవాటు ఉందా?",
    "expertVerdict": "నిపుణుల తీర్పు",
    "illustrativeNotice": "అన్ని విలువలు ప్రామాణిక పరిశ్రమ ఊహల ఆధారంగా ఉదాహరణలు మాత్రమే.",
    "clearSelections": "ఎంపికలను తొలగించు",
    "pureProtectionDesc": "ఇది ప్యూర్ ప్రొటెక్షన్ ప్లాన్. ప్రతి రూపాయి భారీ లైఫ్ కవర్ కొనడానికే వెళ్తుంది. కుటుంబ భద్రతకు ఇది చాలా సమర్థవంతమైనది.",
    "savingsMaturityDesc": "{age} ఏళ్ల వయస్సులో, మీరు {years} ఏళ్ల పాటు చెల్లిస్తారు. CAGR సుమారుగా {cagr}% ఉంటుంది. తక్కువ ప్రమాదం ఉండే దీర్ఘకాలిక లక్ష్యాలకు ఇది మంచిది.",
    "policyEnd": "పాలసీ ముగింపు",
    "maturitySurvival": "మెచ్యూరిటీ / సర్వైవల్",
    "deathBenefitLabel": "మరణ ప్రయోజనం",
    "deathImmediate": "మరణం (తక్షణం)",
    "morbidity": "రుగ్మత",
    "disabilityCritical": "వైకల్యం / తీవ్రమైన అనారోగ్యం",
    "plan": "ప్లాన్",
    "dosButton": "క్లెయిమ్ తిరస్కరణను నివారించే మార్గాలు",
    "lifeDo1": "మునుపటి మొత్తం ఇన్సూరెన్స్ పాలసీలు మరియు తిరస్కరణ వివరాలను తెలియజేయండి.",
    "lifeDo2": "తగినంత హ్యూమన్ లైఫ్ వాల్యూ కవరేజ్ కోసం మీ ఆదాయాన్ని ఖచ్చితంగా పేర్కొనండి.",
    "lifeDo3": "మీ ధూమపానం మరియు మద్యపాన అలవాట్లను నిజాయితీగా తెలియజేయండి.",
    "lifeDo4": "మీకు వివాహం జరిగినా లేదా పిల్లలు పుట్టినా నామినీ వివరాలను అప్‌డేట్ చేయండి.",
    "lifeDo5": "ఫ్రీ లుక్ పీరియడ్‌లో సరైన సమ్ అష్యూర్డ్ మరియు నామినీ పేరు కోసం పాలసీ బాండ్‌ను తనిఖీ చేయండి.",
    "lifeDont1": "ప్రతి ఫీల్డ్‌ను తనిఖీ చేయకుండా ఏజెంట్‌ను ఫారమ్ నింపనివ్వవద్దు.",
    "lifeDont2": "కుటుంబంలో వంశపారంపర్య వ్యాధుల చరిత్రను దాచవద్దు.",
    "lifeDont3": "ఆత్మహత్య మరణ క్లెయిమ్‌ల కోసం వెయిటింగ్ పీరియడ్ (సాధారణంగా 1 సంవత్సరం) విస్మరించవద్దు.",
    "lifeDont4": "ఏ పరిస్థితిలోనూ ఖాళీ ప్రపోజల్ ఫారమ్‌పై సంతకం చేయవద్దు.",
    "lifeDont5": "ప్రతి సంవత్సరం పాలసీ స్థితిని తనిఖీ చేయడం మర్చిపోవద్దు - ప్రీమియం సకాలంలో చెల్లించండి."
  },
  "Tamil": {
    "claimDesc": "உங்கள் கிளைம் ஏன் நிராகரிக்கப்பட்டது మరియు ఎలా ఎదుర్కోవాలి என்பதையும் புரிந்து கொள்ளுங்கள்.",
    "rejectionReason": "நிராகரிப்புக்கான காரணம்",
    "rejectionPlaceholder": "உதாரணமாக: 'ஹெர்னியாவிற்கான 2 ஆண்டுகள் காத்திருப்பு காலம் காரணமாக கிளைம் நிராகரிக்கப்பட்டது'",
    "checkCompliance": "இணக்கத்தை சரிபார்க்கவும்",
    "stepsToFight": "தீர்வுக்கான படிகள்",
    "caseStudy": "வெற்றி பெற்ற சர்ச்சை வழக்கு",
    "irdaiComplaint": "IRDAI பீமா பரோசா",
    "complianceRules": "தொடர்புடைய IRDAI விதிகள்",
    "rejectionEmptyState": "விவரங்களை உள்ளிடவும்.",
    "visitPortal": "போர்ட்டலுக்குச் செல்லவும்",
    "officialResource": "அதிகாரப்பூர்வ ஆதாரம்",
    "rejectionAssessment": "நிராகரிப்பு",
    "summary": "சுருக்கம்",
    "premiumRange": "பிரீமியம் வரம்பு",
    "hospitalNetworks": "நெட்வொர்க் மருத்துவமனைகள்",
    "roomRent": "அறை வாடகை வரம்பு",
    "waitingPeriod": "காத்திருப்பு காலம் (PED)",
    "coPay": "கோ-பேமெண்ட்",
    "preHosp": "மருத்துவமனையில் அனுமதிக்கப்படுவதற்கு முந்தைய செலவுகள்",
    "postHosp": "டிஸ்சார்ஜ் செய்யப்பட்ட பிந்தைய செலவுகள்",
    "dayCare": "டே கேர்",
    "domiciliary": "வீட்டு சிகிச்சை",
    "ambulance": "ஆம்புலன்ஸ்",
    "nonConsumables": "பயன்படுத்த முடியாத பொருட்கள்",
    "renewalDiscount": "கிளைம் இல்லா போனஸ்",
    "opd": "OPD கவரேஜ்",
    "ayush": "ஆயுஷ் (AYUSH)",
    "organDonor": "உறுப்பு தானம் செய்பவர் செலவுகள்",
    "whyRecommended": "ஏன் பரிந்துரைக்கப்படுகிறது?",
    "insurerTrust": "காப்பீட்டாளர் நம்பிக்கை & நற்பெயர்",
    "costValue": "செலவு & மதிப்பு",
    "howItCompares": "இது எப்படி ஒப்பிடப்படுகிறது",
    "keyBenefit": "உங்களுக்கான முக்கிய நன்மை",
    "exploreDetails": "விவரங்களை ஆராயுங்கள்",
    "auditScore": "தணிக்கை மதிப்பெண்",
    "basedOnIrdai": "IRDAI 2024 முதன்மை சுற்றறிக்கைகளின் அடிப்படையில்",
    "findingsDeviations": "கண்டுபிடிப்புகள் & விலகல்கள்",
    "grayAreas": "அஸ்பஷ்டமான பகுதிகள் / சந்தேகங்கள்",
    "proTip": "புரோ-டிப்: இந்த அஸ்பஷ்டமான பகுதிகள் பெரும்பாலும் கிளைம்களை நிராகரிக்க பயன்படுத்தப்படுகின்றன. காப்பீட்டாளரிடம் தெளிவுபடுத்தவும்.",
    "compliant": "இணக்கமானது",
    "nonCompliant": "இணக்கமற்றது",
    "partialCompliant": "பகுதியளவு இணக்கமானது",
    "rejection": "நிராகரிப்பு",
    "skip": "தவிர்",
    "planType": "திட்ட வகை",
    "sumAssured": "காப்பீட்டுத் தொகை",
    "whatWorksBetter": "எது சிறப்பாக செயல்படுகிறது?",
    "strategyComparison": "யுக்தி ஒப்பீடு",
    "maturity": "முதிர்வு பலன்கள்",
    "deathCover": "மொத்த இறப்பு கவரேஜ்",
    "termFdStrategy": "டேர்ம் இன்சூரன்ஸ் + FD/பாண்ட்",
    "termMfStrategy": "டேர்ம் இன்சூரன்ஸ் + குறியீட்டு MF",
    "maturityBenefit": "முதிர்வு பலன்",
    "deathBenefit": "இறப்பு பலன்",
    "policyTerm": "பாலிசி காலம்",
    "premiumTerm": "பிரீமியம் காலம்",
    "riders": "ரைடர்கள்",
    "morbidityBenefit": "मोर्बिडिटी लाभ",
    "maturityPayout": "मॅच्युरिटी पे आऊट",
    "estIrr": "अंदाजे IRR",
    "hideComparison": "तुलना लपवा",
    "annualSplit": "वार्षिक विभाजन",
    "estMaturity": "अंदाजे परिपक्वता",
    "deathLifeCover": "लाईफ कव्हर (मृत्यू)",
    "flexibility": "लवचिकता",
    "fullToInsurer": "पूर्ण विमा कंपनीला",
    "buyTermInvestDiff": "टर्म विमा घ्या आणि फरक गुंतवा",
    "splitPremiumAdvise_part1": "तुमच्या",
    "splitPremiumAdvise_part2": "प्रीमियमचे विभाजन करा जेणेकरून तुम्हाला १० पट विम्यापेक्षा अधिक संरक्षण आणि चांगले लाभ मिळतील.",
    "proTipStrategy": "प्रो टिप: पारंपारिक 'बचत' विमा योजना अनेकदा कमी कव्हरसह ५-६% परतावा मिळतात. तुमचा विमा (प्युअर टर्म) आणि तुमची गुंतवणूक (FD/MF) वेगळी ठेवल्यास तुम्हाला उत्तम सुरक्षा आणि उच्च आर्थिक वाढ मिळेल.",
    "termFd7": "टर्म + FD (7%)",
    "termMf12": "टर्म + MF (12%)",
    "lockedLow": "लॉक केलेले (कमी)",
    "fullPartial": "पूर्ण (अंशतः)",
    "highFlex": "उच्च लवचिकता",
    "comparisonMetric": "तुलनेचे निकष",
    "netGain": "निव्वळ नफा (प्रीमियम व्यतिरिक्त)",
    "totalPremiumPaid": "एकूण भरलेला प्रीमियम",
    "payoutAnalysis": "पेआउट विश्लेषण",
    "event": "प्रसंग",
    "benefitType": "लाभाचा प्रकार",
    "amount": "रक्कम",
    "zeroProtection": "शून्य (केवळ संरक्षण)",
    "returnsCalc": "रिटर्न्स कॅल्क्युलेटर",
    "xirr": "XIRR",
    "cagr": "CAGR",
    "selectRiders": "रायडर्स निवडा",
    "totalPremium": "एकूण प्रीमियम",
    "compoundedAnnually": "वार्षिक चक्रवाढ",
    "comparisonTable": "पॉलिसी तुलना तक्ता",
    "currentAge": "तुमचे सध्याचे वय",
    "yes": "हो",
    "no": "नाही",
    "smoker": "धूम्रपान करता का?",
    "expertVerdict": "तज्ज्ञ मत",
    "illustrativeNotice": "सर्व मूल्ये मानक उद्योग गृहितकांवर आधारित आहेत.",
    "clearSelections": "निवड रद्द करा",
    "pureProtectionDesc": "பாதுகாப்புத் திட்டம். ஒவ்வொரு ரூபாயும் ஒரு பெரிய ஆயுள் காப்பீட்டை வாங்குவதற்குச் செல்கிறது. குடும்பப் பாதுகாப்பிற்கு மிகச் சிறந்தது.",
    "savingsMaturityDesc": "{age} வயதில், நீங்கள் {years} ஆண்டுகளுக்குப் பணம் செலுத்துகிறீர்கள். CAGR தோராயமாக {cagr}% ஆகும். குறைந்த அபாயம் கொண்ட நீண்ட கால இலக்குகளுக்கு இது நல்லது.",
    "policyEnd": "பாலிசி முடிவு",
    "maturitySurvival": "முதிர்வு / வாழ்நாள் பயன்",
    "deathBenefitLabel": "இறப்பு பலன்",
    "deathImmediate": "இறப்பு (உடனடி)",
    "morbidity": "நோய் பாதிப்பு",
    "disabilityCritical": "ஊனம் / கடுமையான நோய்",
    "plan": "திட்டம்",
    "explore": "பாலிசி எக்ஸ்ப்ளோரர்",
    "compare": "ஒப்பிடுக",
    "recommend": "பரிந்துரைகள்",
    "assistant": "காப்பீட்டு உதவியாளர்",
    "heroTitle": "உங்கள் சுகாதார பாதுகாப்பை எளிதாக்குங்கள்",
    "heroSub": "கடினமான சொற்கள் இல்லாமல் இந்திய சுகாதார காப்பீட்டு பாலிசிகளை ஒப்பிடுங்கள்.",
    "hospitals": "மருத்துவமனைகள்",
    "premium": "மதிப்பிடப்பட்ட பிரீமியம்",
    "explain": "விவரங்களை அறியுங்கள்",
    "back": "பின்செல்",
    "feature": "அம்சம்",
    "gist": "சுருக்கம்",
    "verdict": "நிபுணர் கருத்து",
    "nuances": "நுட்பங்கள்",
    "criticalExclusionsHead": "முக்கிய விலக்குகள்",
    "profileTitle": "உங்கள் சுயவிவரம்",
    "age": "வயது",
    "knowYourPolicy": "உங்கள் பாலிசியை அறிந்து கொள்ளுங்கள்",
    "knowYourPolicyDesc": "விவரமாகப் புரிந்துகொள்ள உங்கள் பாலிசியைப் பதிவேற்றவும்",
    "processing": "பகுப்பாய்வு செய்யப்படுகிறது...",
    "keyTerms": "முக்கிய விதிமுறைகள்",
    "policyExclusions": "விலக்குகள்",
    "limitations": "கட்டுப்பாடுகள்"
  },
  "Malayalam": {
    "explore": "പോളിസി എക്സ്പ്ലോരർ",
    "compare": "താരതമ്യം",
    "recommend": "ശുപാർശകൾ",
    "assistant": "ഇൻഷുറൻസ് അസിസ്റ്റന്റ്",
    "heroTitle": "നിങ്ങളുടെ ആരോഗ്യ സുരക്ഷ ലളിതമാക്കുക",
    "heroSub": "സങ്കീർണ്ണമായ പദങ്ങളില്ലാതെ ഇന്ത്യൻ ആരോഗ്യ ഇൻഷുറൻസ് പോളിസികൾ താരതമ്യം ചെയ്യുക.",
    "hospitals": "ആശുപത്രികൾ",
    "premium": "പ്രീമിയം തുക",
    "explain": "വിശദാംശങ്ങൾ അറിയുക",
    "back": "പിന്നിലേക്ക്",
    "feature": "ഫീച്ചർ",
    "gist": "സംഗ്രഹം",
    "verdict": "വിദഗ്ദ്ധ അഭിപ്രായം",
    "nuances": "സൂക്ഷ്മ വിശദാംശങ്ങൾ",
    "criticalExclusionsHead": "പ്രധാന ഒഴിവാക്കലുകൾ",
    "profileTitle": "നിങ്ങളുടെ പ്രൊഫൈൽ",
    "age": "വയസ്സ്",
    "maritalStatus": "വൈവാഹിക്ക നില",
    "single": "അവിവാഹിതൻ/അവിവാഹിത",
    "married": "വിവാഹിതൻ/വിവാഹിത",
    "widow": "വിധവ/വിധുരൻ",
    "divorced": "വിവാഹമോചിതൻ/വിവാഹമോചിത",
    "ped": "മുൻപുള്ള അസുഖങ്ങൾ",
    "gender": "ലിംഗം",
    "city": "നഗരം",
    "lifestyle": "ജീവിതശൈലി",
    "smoking": "പുകവലി",
    "drinking": "മദ്യപാനം",
    "surgery": "ശസ്ത്രക്രിയ ചരിത്രം",
    "medication": "മരുന്ന് ഉപയോഗം",
    "thyroid": "തൈറോയ്ഡ്",
    "none": "ഒന്നുമില്ല",
    "generate": "ശുപാർശ നേടുക",
    "topMatches": "മികച്ച തിരഞ്ഞെടുപ്പുകൾ",
    "scenario": "സാഹചര്യം / ചോദ്യം",
    "placeholder": "ഉദാ: 'എനിക്ക് പ്രമേഹമുണ്ട്. ഇത് ഇൻസുലിൻ ഉൾക്കൊള്ളുന്നുണ്ടോ?'",
    "simplify": "നിബന്ധനകൾ ലളിതമാക്കുക",
    "yearsInBusiness": "ബിസിനസ്സിലെ വർഷങ്ങൾ",
    "activeCustomers": "സജീവ ഉപഭോക്താക്കൾ",
    "policiesSold": "വിൽക്കപ്പെട്ട പോളിസികൾ / വർഷം",
    "rejectionRate": "ക്ലെയിം നിരസിക്കൽ",
    "complaints": "പരാതികൾ / 10k",
    "last5Years": "IRDAI പ്രകടനം (5വ)",
    "about": "ഇൻഷുററെ കുറിച്ച്",
    "close": "അടയ്ക്കുക",
    "knowYourPolicy": "പോളിസി അറിയുക",
    "knowYourPolicyDesc": "വിശദമായി മനസ്സിലാക്കാൻ പോളിസി അപ്‌ലോഡ് ചെയ്യുക",
    "processing": "വിശകലനം ചെയ്യുന്നു...",
    "keyTerms": "പ്രധാന നിബന്ധനകൾ",
    "policyExclusions": "ഒഴിവാക്കലുകൾ",
    "limitations": "പരിധികൾ",
    "uploadPrompt": "പിഡിഎഫ് അപ്‌ലോഡ് ചെയ്യുക",
    "analysisComplete": "വിശകലനം പൂർത്തിയായി",
    "previousAnalyses": "പഴയ വിശകലനങ്ങൾ",
    "compliance": "IRDAI അനുസരണം",
    "claims": "ക്ലെയിംസ് & കംപ്ലയൻസ്",
    "claimDesc": "IRDAI നിയമങ്ങൾ അനുസരിച്ച് ക്ലെയിം എന്തുകൊണ്ട് നിരസിക്കപ്പെട്ടു എന്ന് മനസ്സിലാക്കുക.",
    "rejectionReason": "നിരസിക്കാനുള്ള കാരണം",
    "rejectionPlaceholder": "ഉദാ: 'ഹെർണിയയ്ക്കുള്ള 2 വർഷത്തെ വെയ്റ്റിംഗ് പിരീഡ് കാരണം ക്ലെയിം നിരസിച്ചു'",
    "checkCompliance": "അനുസരണം പരിശോധിക്കുക",
    "stepsToFight": "പരിഹാര നടപടികൾ",
    "caseStudy": "വിജയകരമായ തർക്ക കേസ്",
    "irdaiComplaint": "IRDAI ബീമാ ഭരോസ",
    "complianceRules": "പ്രസക്തമായ IRDAI നിയമങ്ങൾ",
    "rejectionEmptyState": "നിരസിച്ച വിശദാംശങ്ങൾ നൽകുക.",
    "visitPortal": "പോർട്ടൽ സന്ദർശിക്കുക",
    "officialResource": "ഔദ്യോഗിക വിഭവം",
    "rejectionAssessment": "നിരസിക്കൽ",
    "summary": "സംഗ്രഹം",
    "premiumRange": "പ്രീമിയം പരിധി",
    "hospitalNetworks": "നെറ്റ്‌വർക്ക് ആശുപത്രികൾ",
    "roomRent": "റൂം വാടക പരിധി",
    "waitingPeriod": "വെയ്റ്റിംഗ് പിരീഡ് (PED)",
    "coPay": "കോ-പേയ്‌മെന്റ്",
    "preHosp": "അഡ്മിഷന് മുൻപുള്ള ചിലവ്",
    "postHosp": "ഡിസ്ചാർജിന് ശേഷമുള്ള ചിലവ്",
    "dayCare": "ഡേ കെയർ",
    "domiciliary": "വീട്ടുചികിത്സ",
    "ambulance": "ആംബുലൻസ്",
    "nonConsumables": "നോൺ കൺസ്യൂമബിൾസ്",
    "renewalDiscount": "നോ ക്ലെയിം ബോണസ്",
    "opd": "OPD കവറേജ്",
    "ayush": "ആയുഷ്",
    "organDonor": "അവയവദാന ചിലവുകൾ",
    "whyRecommended": "എന്തുകൊണ്ട് ശുപാർശ ചെയ്യുന്നു?",
    "insurerTrust": "വിശ്വാസ്യതയും പ്രശസ്തിയും",
    "costValue": "ചിലവും മൂല്യവും",
    "howItCompares": "ഇത് എങ്ങനെ താരതമ്യപ്പെടുത്തുന്നു",
    "keyBenefit": "നിങ്ങൾക്കുള്ള പ്രധാന നേട്ടം",
    "exploreDetails": "വിവരങ്ങൾ പരിശോധിക്കുക",
    "auditScore": "ഓഡിറ്റ് സ്കോർ",
    "basedOnIrdai": "IRDAI 2024 സർക്കുലറുകൾ അടിസ്ഥാനമാക്കി",
    "findingsDeviations": "കണ്ടെത്തലുകളും വ്യതിയാനങ്ങളും",
    "grayAreas": "അവ്യക്ത മേഖലകൾ",
    "proTip": "ഇൻഷുററുമായി വ്യക്തത വരുത്തുക.",
    "compliant": "അനുയോജ്യമായത്",
    "nonCompliant": "അല്ലാത്തത്",
    "partialCompliant": "ഭാഗികമായി പാലിക്കുന്നത്",
    "rejection": "നിരസിക്കൽ",
    "skip": "ഒഴിവാക്കുക",
    "planType": "പ്ലാൻ ടൈപ്പ്",
    "sumAssured": "ഇൻഷുറൻസ് തുക",
    "whatWorksBetter": "ഏതാണ് മികച്ചത്?",
    "strategyComparison": "താരതമ്യ വിശകലനം",
    "maturity": "മെച്യൂരിറ്റി ബെനഫിറ്റ്സ്",
    "deathCover": "മൊത്തം ഡെത്ത് കവർ",
    "termFdStrategy": "ടേം ഇൻഷുറൻസ് + FD/ബോണ്ട്",
    "termMfStrategy": "ടേം ഇൻഷുറൻസ് + ഇൻഡക്സ് MF",
    "maturityBenefit": "മെച്യൂരിറ്റി ബെനഫിറ്റ്",
    "deathBenefit": "ഡെത്ത് ബെനഫിറ്റ്",
    "policyTerm": "പോളിസി കാലാവധി",
    "premiumTerm": "പ്രീമിയം കാലാവധി",
    "riders": "റൈഡറുകൾ",
    "morbidityBenefit": "രോഗാവസ്ഥ ആനുകൂല്യം",
    "maturityPayout": "മെച്യൂരിറ്റി പേഔട്ട്",
    "estIrr": "അവലോകനം ചെയ്ത IRR",
    "hideComparison": "താരതമ്യം മറയ്ക്കുക",
    "annualSplit": "വാർഷിക വിഭജനം",
    "estMaturity": "അവലോകനം ചെയ്ത മെച്യൂരിറ്റി",
    "deathLifeCover": "ലൈഫ് കവർ (മരണം)",
    "flexibility": "ഫ്ലെക്സിബിലിറ്റി",
    "fullToInsurer": "പൂർണ്ണമായും ഇൻഷുറർക്ക്",
    "buyTermInvestDiff": "ടേം ഇൻഷുറൻസ് എടുത്ത് ബാക്കി നിക്ഷേപിക്കുക",
    "splitPremiumAdvise_part1": "നിങ്ങളുടെ",
    "splitPremiumAdvise_part2": "പ്രീമിയം 10 മടങ്ങ് അധിക പരിരക്ഷയ്ക്കും മെച്ചപ്പെട്ട ലാഭത്തിനുമായി വിഭജിക്കുക.",
    "proTipStrategy": "പ്രോ ടിപ്പ്: പരമ്പരാഗത 'സേവിംഗ്സ്' ഇൻഷുറൻസ് പ്ലാനുകൾ പലപ്പോഴും കുറഞ്ഞ പരിരക്ഷയോടെ 5-6% ലാഭം മാത്രമേ നൽകുന്നുള്ളൂ. നിങ്ങളുടെ ഇൻഷുറൻസും (പ്യൂർ ടേം) നിക്ഷേപങ്ങളും (FD/MF) വേർതിരിക്കുന്നത് നിങ്ങൾക്ക് മികച്ച സുരക്ഷയും ഉയർന്ന സാമ്പത്തിക വളർച്ചയും നൽകും.",
    "termFd7": "ടേം + FD (7%)",
    "termMf12": "ടേം + MF (12%)",
    "lockedLow": "ലോക്ക് ചെയ്തത് (കുറവ്)",
    "fullPartial": "പൂർണ്ണം (ഭാഗികം)",
    "highFlex": "ഹൈ ഫ്ലെക്സിബിലിറ്റി",
    "comparisonMetric": "താരതമ്യ മാനദണ്ഡം",
    "netGain": "അറ്റാദായം (പ്രീമിയത്തിന് മുകളിൽ)",
    "totalPremiumPaid": "ആകെ അടച്ച പ്രീമിയം",
    "payoutAnalysis": "പേഔട്ട് വിശകലനം",
    "event": "സന്ദർഭം",
    "benefitType": "ആനുകൂല്യ തരം",
    "amount": "തുക",
    "zeroProtection": "പൂജ്യം (പരിരക്ഷ മാത്രം)",
    "returnsCalc": "റിട്ടേൺസ് കാൽക്കുലേറ്റർ",
    "currentAge": "നിങ്ങളുടെ നിലവിലെ പ്രായം",
    "yes": "അതെ",
    "no": "അല്ല",
    "smoker": "പുകവലിക്കുന്നയാളാണോ?",
    "expertVerdict": "വിദഗ്ദ്ധ അഭിപ്രായം",
    "illustrativeNotice": "എല്ലാ മൂല്യങ്ങളും സാധാരണ ഇൻഡസ്ട്രി അനുമാനങ്ങളെ അടിസ്ഥാനമാക്കിയുള്ള ഉദാഹരണങ്ങളാണ്.",
    "clearSelections": "തിരഞ്ഞെടുക്കലുകൾ നീക്കം ചെയ്യുക",
    "pureProtectionDesc": "ഇതൊരു പ്യൂർ പ്രൊട്ടക്ഷൻ പ്ലാൻ ആണ്. ഓരോ രൂപയും വലിയൊരു ലൈഫ് കവർ വാങ്ങാനായി ഉപയോഗിക്കുന്നു. കുടുംബ സുരക്ഷയ്ക്ക് ഏറ്റവും അനുയോജ്യം.",
    "savingsMaturityDesc": "{age} വയസ്സിൽ, നിങ്ങൾ {years} വർഷത്തേക്ക് പണമടയ്ക്കുന്നു. CAGR ഏകദേശം {cagr}% ആണ്. കുറഞ്ഞ റിസ്ക് ഉള്ള ദീർഘകാല ലക്ഷ്യങ്ങൾക്ക് നല്ലതാണ്.",
    "policyEnd": "പോളിസി അവസാനിക്കുമ്പോൾ",
    "maturitySurvival": "മെച്യൂരിറ്റി / സർവൈവൽ",
    "deathBenefitLabel": "മരണാനന്തര ആനുകൂല്യം",
    "deathImmediate": "മരണം (ഉടനടി)",
    "morbidity": "രോഗാവസ്ഥ",
    "disabilityCritical": "വൈകല്യം / ഗുരുതരമായ രോഗം",
    "plan": "പ്ലാൻ"
  },
  "Marathi": {
    "termFd7": "ടര്മ + FD (7%)",
    "termMf12": "ടര്മ + MF (12%)",
    "lockedLow": "ലോക്ക കേലേലേ (കമീ)",
    "fullPartial": "പൂര്ണ (അംശതഃ)",
    "highFlex": "ഉച്ച ലവചിക്താ",
    "comparisonMetric": "തുലനേചേ നികഷ",
    "netGain": "നിവ്വള നഫാ (പ്രീമിയമ വ്യതിരിക്ത)",
    "totalPremiumPaid": "ഏകൂണ ഭരണേലേ പ്രീമിയമ",
    "payoutAnalysis": "പേ ഔട്ട വിശ്ലേഷണ",
    "event": "പ്രസംഗ",
    "benefitType": "ലാഭാചാ പ്രകാര",
    "amount": "രക്കമ",
    "zeroProtection": "ശൂന്യ (കേവല സംരക്ഷണമ)",
    "returnsCalc": "റിട്ടേൺസ കാൽക്കുലേറ്റർ",
    "currentAge": "തുമചേ സധ്യാചേ വയ",
    "yes": "ഹോ",
    "no": "നാഹീ",
    "smoker": "ധൂമ്രപാന കരതാ കാ?",
    "expertVerdict": "തജ്ഞ മത",
    "illustrativeNotice": "സര്വ്വ മൂല്യേ മാനക ഉദ്യോഗ ഗീതാംശാവര ആധാരിത ആഹേത.",
    "clearSelections": "നിവഡ രദ്ദ കരാ",
    "pureProtectionDesc": "ഹീ ഏക ശുദ്ധ സംരക്ഷണമ യോജനാ ആഹേ. പ്രത്യേക രൂപയാ ഏകാ മോഠേ ലാഇഫ കവറ ഘേണ്യാനി ഗുന്തവലാ ജാത്തോ. കൗടുംബിക സുരക്ഷാലാ സര്വ്വോത്തമ.",
    "savingsMaturityDesc": "{age} വയസ്സല, തുമഹീ {years} വര്ഷാസാഠീ പ്രീമിയമ ഭരതാ. CAGR ഏകദേശ {cagr}% ആഹേ. കമീ റിസ്ക് ഉള്ള ദീർഘകാല ലക്ഷ്യങ്ങൾക്ക് നല്ലതാണ്.",
    "policyEnd": "പോളിസി സമ്പുഷ്ടീകരണം",
    "maturitySurvival": "മെച്യൂരിറ്റി / സർവൈവൽ",
    "deathBenefitLabel": "മരണാനന്തര ഗുണനിലവാരം",
    "deathImmediate": "മരണം (ഉടനടി)",
    "morbidity": "ആജാരപണം",
    "disabilityCritical": "അപംഗത്വ / ഗുരുകരം ആജാര",
    "plan": "യോജന",
    "explore": "पॉलिसी एक्सप्लोरर",
    "compare": "तुलना करा",
    "recommend": "शिफारसी",
    "assistant": "വിമാ സഹായി",
    "heroTitle": "तुमची आरोग्य सुरक्षा सोपी करा",
    "heroSub": "कठिण शब्दांशिवाय भारतीय आरोग्य विमा पॉलिसींची तुलना करा।",
    "hospitals": "रुग्णालय",
    "premium": "अंदाजे प्रीमियम",
    "explain": "तपशील समजून घ्या",
    "back": "परत",
    "feature": "वैशिष्ट्य",
    "gist": "सारांश",
    "verdict": "तज्ज्ञ निकाल",
    "nuances": "बारीक तपशील",
    "criticalExclusionsHead": "महत्वाचे अपवाद",
    "profileTitle": "तुमची प्रोफाईल",
    "age": "वय",
    "maritalStatus": "वैवाहिक स्थिती",
    "single": "अविवाहित",
    "married": "विवाहित",
    "widow": "विधवा/विधुर",
    "divorced": "घटस्फोटित",
    "ped": "जुने आजार",
    "gender": "लिंग",
    "city": "शहर",
    "lifestyle": "जीवनशैली",
    "smoking": "धूम्रपान",
    "drinking": "मद्यपान",
    "surgery": "शस्त्रक्रिया इतिहास",
    "medication": "औषधोपचार",
    "thyroid": "थायरॉईड",
    "none": "काहीही नाही",
    "generate": "शिफारस मिळवा",
    "topMatches": "सर्वोत्कृष्ट पर्याय",
    "scenario": "परिस्थिती / प्रश्न",
    "placeholder": "उदा: 'मला मधुमेह आहे. यामध्ये इन्सुलिन कव्हर होते का?'",
    "simplify": "शब्द सोपे करा",
    "yearsInBusiness": "व्यवसायातील वर्षे",
    "activeCustomers": "सक्रिय ग्राहक",
    "policiesSold": "विकलेल्या पॉलिसी / वर्ष",
    "rejectionRate": "दावा नाकारण्याचे प्रमाण",
    "complaints": "तक्रारी / १० हजार",
    "last5Years": "IRDAI कामगिरी (५ वर्षे)",
    "about": "विमा कंपनीबद्दल",
    "close": "बंद करा",
    "knowYourPolicy": "तुमची पॉलिसी जाणून घ्या",
    "knowYourPolicyDesc": "तपशीलवार समजून घेण्यासाठी तुमची पॉलिसी अपलोड करा",
    "processing": "विश्लेषण करत आहे...",
    "keyTerms": "मुख्य अटी",
    "policyExclusions": "अपवाद (Exclusions)",
    "limitations": "मर्यादा (Limitations)",
    "uploadPrompt": "पीडीएफ अपलोड करा",
    "analysisComplete": "विश्लेषण पूर्ण झाले",
    "previousAnalyses": "मागील विश्लेषण",
    "compliance": "IRDAI अनुपालन",
    "claims": "दावे आणि अनुपालन",
    "claimDesc": "तुमचा दावा का नाकारला गेला आणि IRDAI कायद्यानुसार त्याविरुद्ध कसे लढावे हे समजून घ्या।",
    "rejectionReason": "दावा नाकारण्याचे कारण",
    "rejectionPlaceholder": "उदा: 'हर्नियासाठी २ वर्षांच्या प्रतीक्षा कालावधीमुळे दावा नाकारला'",
    "checkCompliance": "अनुपालन तपासा",
    "stepsToFight": "निराकरणाचे टप्पे",
    "caseStudy": "यशस्वी केस स्टडी",
    "irdaiComplaint": "IRDAI विमा भरोसा",
    "complianceRules": "संबंधित IRDAI नियम",
    "rejectionEmptyState": "अहवाल तयार करण्यासाठी तपशील प्रविष्ट करा।",
    "visitPortal": "पोर्टलला भेट द्या",
    "officialResource": "अधिकृत स्त्रोत",
    "rejectionAssessment": "अस्वीकृती",
    "summary": "सारांश",
    "premiumRange": "प्रीमियम श्रेणी",
    "hospitalNetworks": "नेटवर्क रुग्णालये",
    "roomRent": "रूम रेंट मर्यादा",
    "waitingPeriod": "प्रतीक्षा कालावधी (PED)",
    "coPay": "को-पेमेंट",
    "preHosp": "रुग्णालयात भरती होण्यापूर्वीचा खर्च",
    "postHosp": "डिस्चार्ज मिळाल्यानंतरचा खर्च",
    "dayCare": "डे केअर",
    "domiciliary": "घरी उपचार",
    "ambulance": "रुग्णवाहिका",
    "nonConsumables": "नॉन-कंज्यूमेबल्स",
    "renewalDiscount": "नो क्लेम बोनस",
    "opd": "OPD कव्हर",
    "ayush": "आयुष (AYUSH)",
    "organDonor": "अवयव दाता खर्च",
    "whyRecommended": "शिफारस का केली गेली?",
    "insurerTrust": "विमा कंपनीचा विश्वास आणि प्रतिष्ठा",
    "costValue": "खर्च आणि मूल्य",
    "howItCompares": "ती कशी तुलना करते",
    "keyBenefit": "तुमच्यासाठी मुख्य फायदा",
    "exploreDetails": "तपशील पहा",
    "auditScore": "ऑडिट स्कोर",
    "basedOnIrdai": "IRDAI 2024 मास्टर परिपत्रकांवर आधारित",
    "findingsDeviations": "निष्कर्ष आणि तफावत",
    "grayAreas": "अस्पष्ट क्षेत्रे / शंका",
    "proTip": "प्रो-टिप: ही अस्पष्ट क्षेत्रे बऱ्याचदा दावे नाकारण्यासाठी वापरली जातात।",
    "compliant": "अनुपालन",
    "nonCompliant": "अनुपालन नाही",
    "partialCompliant": "अंशतः अनुपालन",
    "rejection": "अस्वीकृती",
    "skip": "वगळा",
    "planType": "योजनेचा प्रकार",
    "sumAssured": "विमा रक्कम",
    "whatWorksBetter": "काय अधिक चांगले आहे?",
    "strategyComparison": "रणनीती तुलना",
    "maturity": "मॅच्युरिटी लाभ",
    "deathCover": "एकूण मृत्यू कव्हर",
    "termFdStrategy": "टर्म विमा + FD/बॉन्ड",
    "termMfStrategy": "टर्म विमा + इंडेक्स MF",
    "maturityBenefit": "परिपक्वता लाभ",
    "deathBenefit": "मृत्यू लाभ",
    "policyTerm": "पॉलिसी मुदत",
    "premiumTerm": "हप्ता भरण्याची मुदत",
    "riders": "रायडर्स",
    "morbidityBenefit": "ആജാരപണ ലാഭ",
    "maturityPayout": "മാച്യുരിററി പേ ഔട്ട",
    "estIrr": "അന്ദാജേ IRR",
    "hideComparison": "തുലനാ ലപവാ",
    "annualSplit": "വാർഷിക വിഭജന",
    "estMaturity": "അന്ദാജേ പരിപക്വതാ",
    "deathLifeCover": "ലാഇഫ കവറ (മൃത്യൂ)",
    "flexibility": "ലവചിക്താ",
    "fullToInsurer": "പൂര്ണ വിമാ കമ്പനീലാ",
    "buyTermInvestDiff": "ടര്മ വിമാ ഘ്യാ ആണി ഫരക ഗുന്തവാ",
    "splitPremiumAdvise_part1": "തുമച്യാ",
    "splitPremiumAdvise_part2": "പ്രീമിയമചേ വിഭജന കരാ ജേണേകറൂന തുമഹാലാ 10 പട വിമ്യാപേക്ഷാ അധിക സംരക്ഷണമ ആണി ചാംഗലേ ലാഭ മിളതീല.",
    "proTipStrategy": "പ്രോ ടിപ്: പാരംപാരിക 'ബചത' വിമാ യോജനാ അനേകദാ കമീ കവരസഹ 5-6% പാരതോഷിക മിളതാത. തുമചാ വിമാ (പ്യുറ ടേമ) ആണി തുമചീ ഗുന്തവണുകൂ (FD/MF) വേഗളീ ഠേവല്യാസ തുമഹാലാ ഉത്തമ സുരക്ഷാ ആണി ഉച്ച സാമ്പത്തിക വളർച്ച മിളും."
  }
};

export default function App() {
  const [view, setView] = useState("home");
  const [language, setLanguage] = useState("English");
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [translatedPolicies, setTranslatedPolicies] = useState<Policy[]>([]);
  const [selectedPolicies, setSelectedPolicies] = useState<string[]>([]);
  const [activePolicyId, setActivePolicyId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [analysis, setAnalysis] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [showVideo, setShowVideo] = useState(false);
  const [insuranceType, setInsuranceType] = useState("health");
  const [profile, setProfile] = useState<any>({
    age: 27,
    maritalStatus: "Single",
    city: "Mumbai",
    ped: "None",
    preExisting: ["None"],
    gender: "Male",
    surgery: "No",
    medication: "No",
    smoking: "No",
    drinking: "No"
  });
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<any>(null);
  const [translating, setTranslating] = useState(false);
  const [insurerClaims, setInsurerClaims] = useState<any>([]);
  const [selectedCompany, setSelectedCompany] = useState<any>(null);
  const [isCompanyPanelOpen, setIsCompanyPanelOpen] = useState(false);
  const [claimScenario, setClaimScenario] = useState("");
  const [claimAnalysis, setClaimAnalysis] = useState<any>(null);
  const [recommendations, setRecommendations] = useState<any[]>([]);
  const [calcAge, setCalcAge] = useState(27);
  const [calcPremium, setCalcPremium] = useState(50000);
  const [calcSumAssured, setCalcSumAssured] = useState(0);
  const [calcHealth, setCalcHealth] = useState("Healthy");
  const [calcSmoker, setCalcSmoker] = useState(false);
  const [showCalculatorId, setShowCalculatorId] = useState<string | null>(null);
  const [showRefTableId, setShowRefTableId] = useState<string | null>(null);
  const [showComparisonTableId, setShowComparisonTableId] = useState<string | null>(null);
  const [showDetailedClaims, setShowDetailedClaims] = useState(false);
  const [showDosPanel, setShowDosPanel] = useState(false);
  const [showStrategicComparison, setShowStrategicComparison] = useState(false);
  const [activeTab, setActiveTab] = useState("overview");
  const [lifeCategory, setLifeCategory] = useState("All");
  const [userPolicies, setUserPolicies] = useState<any[]>([]);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [showRidersId, setShowRidersId] = useState<string | null>(null);
  const [selectedRiders, setSelectedRiders] = useState<Record<string, any[]>>({});

  const t = translations[language] || translations["English"];

  const getPolicyTotalPremium = (policy: any) => {
    let base = 0;
    const baseVal = policy.basePremium || (insuranceType === "health" ? 8500 : 25000);
    if (insuranceType === "health") {
      base = baseVal * (1 + Math.max(0, calcAge - 27) * 0.02);
    } else {
      base = baseVal * (1 + Math.max(0, calcAge - 27) * 0.04) * (calcSmoker ? 1.5 : 1.0);
    }
    const selected = selectedRiders[policy.id] || [];
    const ridersCost = selected.reduce((acc: number, r: any) => {
      if (r.type === "fixed") return acc + r.base;
      if (r.type === "percent") return acc + (base * (r.base / 100));
      return acc;
    }, 0);
    return Math.round(base + ridersCost);
  };

  const speak = useCallback((text: string) => {
    return new Promise<void>((resolve) => {
      const utter = () => {
        const utterance = new SpeechSynthesisUtterance(text);
        const voices = window.speechSynthesis.getVoices();
        const voiceMapping: any = {
          "English": "en-IN",
          "Hindi": "hi-IN",
          "Kannada": "kn-IN",
          "Telugu": "te-IN",
          "Tamil": "ta-IN",
          "Malayalam": "ml-IN",
          "Marathi": "mr-IN"
        };
        const langCode = voiceMapping[language] || "en-IN";
        const voice = voices.find(v => v.lang.startsWith(langCode)) || voices.find(v => v.lang.startsWith("en-IN")) || voices[0];
        if (voice) utterance.voice = voice;
        utterance.onstart = () => setIsSpeaking(true);
        utterance.onend = () => { setIsSpeaking(false); resolve(); };
        utterance.onerror = () => { setIsSpeaking(false); resolve(); };
        window.speechSynthesis.speak(utterance);
      };
      if (window.speechSynthesis.getVoices().length === 0) {
        window.speechSynthesis.onvoiceschanged = () => { utter(); window.speechSynthesis.onvoiceschanged = null; };
      } else utter();
    });
  }, [language]);

  const startListening = useCallback(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.lang = language === "Hindi" ? "hi-IN" : "en-IN";
      recognition.onstart = () => setIsListening(true);
      recognition.onresult = (event: any) => { setQuery(event.results[0][0].transcript); setIsListening(false); };
      recognition.onerror = () => setIsListening(false);
      recognition.onend = () => setIsListening(false);
      recognition.start();
    }
  }, [language]);

  useEffect(() => {
    const translateAnalysis = async () => {
      if (!analysisResult || language === "English" || analysisResult.translatedTo === language) return;
      setTranslating(true);
      try {
        const parsed = await safeFetchJSON("/api/ai/translate-analysis", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ language, data: { analysis: analysisResult } })
        });
        setAnalysisResult({ ...analysisResult, ...parsed, translatedTo: language });
      } catch (e) { console.error(e); } finally { setTranslating(false); }
    };
    translateAnalysis();
  }, [language, analysisResult?.id]);


  useEffect(() => {
    safeFetchJSON("/api/insurer-claims").then(setInsurerClaims).catch(console.error);
  }, []);

  useEffect(() => {
    const fetchPolicies = async () => {
      try {
        const endpoint = insuranceType === "health" ? "/api/policies" : "/api/life-policies";
        const data = await safeFetchJSON(endpoint);
        setPolicies(data);
        setTranslatedPolicies(data);
      } catch (err) { console.error(err); }
    };
    fetchPolicies();
  }, [insuranceType]);

  useEffect(() => {
    const translateContent = async () => {
      if (language === "English" || policies.length === 0) { setTranslatedPolicies(policies); return; }
      setTranslating(true);
      try {
        const cached = await safeFetchJSON(`/api/translations/${language}`);
        if (cached && cached.length > 0) {
          setTranslatedPolicies(policies); 
        } else {
          setTranslatedPolicies(policies);
        }
      } catch (e) { setTranslatedPolicies(policies); } finally { setTranslating(false); }
    };
    translateContent();
  }, [language, policies]);

  const handleAnalyze = async () => {
    if (!activePolicyId || !query) return;
    const policy = policies.find(p => p.id === activePolicyId);
    if (!policy) return;
    setLoading(true);
    try {
      const parsed = await safeFetchJSON("/api/ai/analyze-policy-query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language, data: { policy, query } })
      });
      setAnalysis(parsed);
    } catch (e) { console.error(e); } finally { setLoading(false); }
  };

  useEffect(() => {
    const fetchUserPolicies = async () => {
      try {
        const data = await safeFetchJSON("/api/user-policies/anonymous");
        setUserPolicies(data);
      } catch (e) { console.error(e); }
    };
    fetchUserPolicies();
  }, []);

  const handleCompanyClick = async (name: string) => {
    try {
      const data = await safeFetchJSON(`/api/companies/${encodeURIComponent(name)}`);
      setSelectedCompany(data);
      setIsCompanyPanelOpen(true);
    } catch (e) { console.error(e); }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setIsAnalyzing(true);
    setUploadError(null);
    try {
      const formData = new FormData();
      formData.append("policyFile", file);
      const extractionResult = await safeFetchJSON("/api/pdf-extract", { method: "POST", body: formData });
      const result = await safeFetchJSON("/api/ai/analyze-uploaded-policy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language, data: { text: extractionResult.text.slice(0, 50000) } })
      });
      setAnalysisResult(result);
    } catch (e) { 
      console.error(e); 
      setUploadError("Failed to analyze policy. Please try again.");
    } finally { setIsAnalyzing(false); }
  };

  const handleClaimAnalysis = async () => {
    if (!claimScenario) return;
    setLoading(true);
    try {
      const parsed = await safeFetchJSON("/api/ai/analyze-claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language, data: { scenario: claimScenario } })
      });
      setClaimAnalysis(parsed);
    } catch (e) { console.error(e); } finally { setLoading(false); }
  };

  const handleRecommend = async () => {
    if (policies.length === 0) return;
    setLoading(true);
    setRecommendations([]); // Clear previous
    try {
      console.log(`[AI] Requesting recommendations for ${insuranceType}. Policies count: ${policies.length}`);
      const data = await safeFetchJSON("/api/ai/recommend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          language, 
          data: { 
            profile, 
            policies: (translatedPolicies.length > 0 ? translatedPolicies : policies),
            insuranceType 
          } 
        })
      });
      
      if (data?.recommendations && data.recommendations.length > 0) {
        setRecommendations(data.recommendations);
      } else {
        console.warn("No recommendations returned from AI");
        alert("The AI could not find specific matches for your profile in the current database. Try adjusting your age or health status.");
      }
    } catch (e) { 
      console.error("Recommendation error:", e);
      alert(`Recommendation failed: ${e instanceof Error ? e.message : 'Unknown error'}`);
    } finally { 
      setLoading(false); 
      setView("recommend");
    }
  };

  const toggleCompare = (id: string) => {
    setSelectedPolicies(prev => prev.includes(id) ? prev.filter(i => i !== id) : prev.length < 3 ? [...prev, id] : prev);
  };

  return (
    <div className="min-h-screen bg-[#FDFCFB] text-[#2D2D2D] font-sans selection:bg-[#E2E8F0]">
      <AnimatePresence>
        {showCalculatorId && !showRefTableId && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
            onClick={() => setShowCalculatorId(null)}
          >
            <motion.div
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="bg-white w-full max-w-4xl rounded-[32px] shadow-2xl overflow-hidden flex flex-col md:flex-row max-h-[95vh] relative"
              onClick={(e) => e.stopPropagation()}
            >

              <button 
                onClick={() => setShowCalculatorId(null)}
                className="absolute top-4 right-4 z-10 p-2 bg-white/10 hover:bg-white/20 rounded-full md:hidden text-white"
              >
                <X className="w-6 h-6" />
              </button>
              {(() => {
                const policy = policies.find(p => p.id === showCalculatorId);
                if (!policy) return null;
                
                // Initialize default premium if not set
                const activePremium = calcPremium || policy.basePremium || 50000;
                // Pure 1Cr Term estimate (realistic market rate)
                const estTermPremium = Math.max(7500 + (calcAge - 18) * 380, 8000);
                const investable = Math.max(activePremium - estTermPremium, 0);

                const calculateFV = (annualP: number, rate: number, years: number, depositYears: number) => {
                  let fv = 0;
                  for (let i = 0; i < years; i++) {
                    if (i < depositYears) fv += annualP;
                    fv *= (1 + rate);
                  }
                  return fv;
                };

                const term = parseInt(policy.policyTerm?.replace(/[^0-9]/g, "") || "20") || 20;
                const payingTerm = Math.min(term, 10);
                const totalPremium = activePremium * payingTerm;
                
                // Risk multipliers based on medical details
                const medicalMultiplier = calcHealth === "Chronic" ? 1.5 : calcHealth === "Minor" ? 1.2 : 1.0;
                const smokerMultiplier = calcSmoker ? 1.4 : 1.0;
                const ageFactor = (calcAge - 18) * 0.02; 
                const totalRiskFactor = medicalMultiplier * smokerMultiplier * (1 + ageFactor);

                const isTerm = policy.plan_type?.includes("Term");
                const baseSumAssured = calcSumAssured || (isTerm 
                  ? (parseInt(policy.sumAssured?.replace(/[^0-9]/g, "") || "10000000") || 10000000)
                  : activePremium * 12);
                
                const sumAssuredVal = calcSumAssured ? calcSumAssured : Math.floor(baseSumAssured / (totalRiskFactor * 0.8));

                const dbXIRR = policy.expectedXIRR;
                const actualXirrRate = isTerm ? 0 : (dbXIRR || (policy.plan_type?.includes("ULIP") ? 10.2 : 5.8)) / 100;
                
                // Refined Maturity Estimate for Indian Traditional Plans: Sum Assured + Accrued Bonuses
                const estBonusRate = policy.plan_type?.includes("ULIP") ? 0.08 : 0.048;
                const isTraditional = !isTerm && !policy.plan_type?.includes("ULIP");
                const maturityEstimate = isTerm ? 0 
                  : isTraditional 
                    ? sumAssuredVal * (1 + (estBonusRate * term))
                    : calculateFV(activePremium, actualXirrRate, term, payingTerm);
                
                const xirr = isTerm ? "N/A" : `${(actualXirrRate * 100).toFixed(1)}%`;
                const cagrDisplay = isTerm ? "N/A" : `${(actualXirrRate * 0.94).toFixed(1)}%`; // Rough heuristic for CAGR vs XIRR in typical endowment

                return (
                  <>
                    <div className="md:w-1/3 bg-[#0F172A] p-8 text-white flex flex-col md:max-h-full max-h-[50vh] overflow-y-auto border-b md:border-b-0 md:border-r border-slate-800">
                      <div className="flex-1">
                        <div className="w-12 h-12 bg-blue-600 rounded-2xl flex items-center justify-center mb-6 shadow-lg shadow-blue-500/20 text-white">
                          <TrendingUp className="w-6 h-6" />
                        </div>
                        <h2 className="text-2xl font-black mb-1">{t.returnsCalc || "Returns Calc"}</h2>
                        <p className="text-slate-400 text-xs">{t.plan || "Plan"}: {policy.name}</p>
                        
                        <div className="mt-8 space-y-6">
                          <div className="space-y-2">
                            <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500">{t.currentAge || "Your Current Age"}</label>
                            <input 
                              type="number" 
                              value={calcAge || ""} 
                              placeholder="e.g. 27"
                              onChange={(e) => {
                                const newAge = e.target.value === "" ? 0 : parseInt(e.target.value);
                                setCalcAge(newAge);
                                const ageFactor = 1 + (Math.max(0, newAge - 18)) * 0.03;
                                const isTerm = policy.plan_type?.includes("Term");
                                setCalcPremium(Math.round((policy.basePremium || 25000) * ageFactor));
                                setCalcSumAssured(isTerm ? (parseInt(policy.sumAssured?.replace(/[^0-9]/g, "") || "10000000") || 10000000) : Math.round((policy.basePremium || 25000) * 12 * (1 + (Math.max(0, newAge - 18)) * 0.01)));
                              }}
                              className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all font-mono"
                            />
                          </div>

                          <div className="space-y-2">
                            <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Manual Yearly Premium (₹)</label>
                            <input 
                              type="number" 
                              value={calcPremium || ""} 
                              onChange={(e) => setCalcPremium(parseInt(e.target.value) || 0)}
                              className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all font-mono"
                            />
                          </div>

                          <div className="space-y-2">
                            <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Sum Assured Target (₹)</label>
                            <input 
                              type="number" 
                              value={calcSumAssured || ""} 
                              onChange={(e) => setCalcSumAssured(parseInt(e.target.value) || 0)}
                              className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all font-mono"
                            />
                          </div>

                          <div className="space-y-2">
                            <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Health Status</label>
                            <div className="grid grid-cols-3 gap-2">
                              {["Healthy", "Minor", "Chronic"].map(h => (
                                <button 
                                  key={h}
                                  onClick={() => setCalcHealth(h)}
                                  className={cn(
                                    "py-2 text-[8px] font-black uppercase tracking-widest rounded-lg border transition-all",
                                    calcHealth === h ? "bg-blue-600 border-blue-600 text-white shadow-lg shadow-blue-500/20" : "bg-slate-800 border-slate-700 text-slate-400 hover:border-slate-600"
                                  )}
                                >
                                  {h}
                                </button>
                              ))}
                            </div>
                          </div>

                          <button 
                            onClick={(e) => { e.stopPropagation(); setShowRefTableId(policy.id); }}
                            className="w-full py-3 px-4 bg-slate-800 border border-slate-700 rounded-xl flex items-center justify-between hover:bg-slate-700 transition-all group"
                          >
                            <div className="flex items-center gap-3">
                              <div className="p-2 bg-blue-500/10 rounded-lg group-hover:bg-blue-500/20">
                                <BarChart className="w-4 h-4 text-blue-400" />
                              </div>
                              <div className="text-left">
                                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Premium vs Age</p>
                                <p className="text-xs font-bold text-slate-300">View Policy Table</p>
                              </div>
                            </div>
                            <ChevronRight className="w-4 h-4 text-slate-500" />
                          </button>

                          <div className="grid grid-cols-2 gap-3">
                            <div className="bg-slate-800/40 p-3 rounded-xl border border-slate-700/30">
                              <p className="text-[9px] font-bold text-slate-500 uppercase tracking-tight mb-1">Yearly Premium</p>
                              <p className="font-mono text-sm font-bold text-blue-400">₹{Math.round(activePremium).toLocaleString('en-IN')}</p>
                            </div>
                            <div className="bg-slate-800/40 p-3 rounded-xl border border-slate-700/30">
                              <p className="text-[9px] font-bold text-slate-500 uppercase tracking-tight mb-1">Life Cover</p>
                              <p className="font-mono text-sm font-bold text-emerald-400">₹{Math.round(sumAssuredVal).toLocaleString('en-IN')}</p>
                            </div>
                          </div>
                          
                          <div className="pt-2 flex items-center justify-between bg-slate-800/50 px-3 py-2 rounded-xl border border-slate-700/50">
                            <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500">{t.smoker || "Smoker?"}</label>
                            <button 
                              onClick={() => setCalcSmoker(!calcSmoker)}
                              className={cn(
                                "px-3 py-1 rounded-lg text-[9px] font-black tracking-widest uppercase transition-all",
                                calcSmoker ? "bg-red-500 text-white" : "bg-slate-700 text-slate-300"
                              )}
                            >
                              {calcSmoker ? (t.yes || "Yes") : (t.no || "No")}
                            </button>
                          </div>
                        </div>
                      </div>
                      
                      <div className="space-y-2 pt-4 border-t border-slate-800">
                        <div className="bg-emerald-500/10 border border-emerald-500/20 p-3 rounded-2xl">
                          <div className="text-[9px] uppercase font-bold tracking-widest text-emerald-500 mb-0.5">{t.maturityPayout || "Maturity Payout"}</div>
                          <div className="text-xl font-black text-emerald-400">
                             {isTerm ? t.zeroProtection || "Zero (Protection)" : `₹ ${Math.round(maturityEstimate).toLocaleString('en-IN')}`}
                          </div>
                        </div>
                        <div className="bg-blue-500/10 border border-blue-500/20 p-3 rounded-2xl flex justify-between items-center">
                          <div>
                            <div className="text-[9px] uppercase font-bold tracking-widest text-blue-500 mb-0.5">{t.estIrr || "Estimated IRR"}</div>
                            <div className="text-xl font-black text-blue-400">{xirr}</div>
                          </div>
                          <div className="text-right">
                             <div className="text-[9px] uppercase font-bold tracking-widest text-blue-500/60 mb-0.5">Approx. CAGR</div>
                             <div className="text-base font-bold text-blue-400/80">{cagrDisplay}</div>
                          </div>
                        </div>
                        
                        {!isTerm && (
                           <button 
                            onClick={(e) => { e.stopPropagation(); setShowStrategicComparison(true); }}
                            className="w-full py-3.5 rounded-2xl font-black text-[10px] uppercase tracking-widest transition-all border flex items-center justify-center gap-3 mt-3 mb-1 active:scale-95 bg-blue-600 border-blue-600 text-white shadow-xl shadow-blue-500/20 hover:bg-blue-700"
                          >
                            <Zap className="w-4 h-4 text-yellow-400 fill-yellow-400" />
                            {t.whatWorksBetter || "What Works Better?"}
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="md:w-2/3 p-8 overflow-y-auto flex-1">
                      <div className="flex justify-between items-center mb-8">
                        <div className="flex items-center gap-3 text-gray-500">
                          <Building className="w-5 h-5" />
                          <span className="font-bold text-gray-900">{policy.company}</span>
                        </div>
                        <button onClick={() => setShowCalculatorId(null)} className="p-2 hover:bg-gray-100 rounded-full transition-all text-gray-400 hover:text-gray-600">
                          <X className="w-5 h-5" />
                        </button>
                      </div>

                      <div className="grid grid-cols-2 gap-4 mb-8">
                        <div className="p-4 bg-gray-50 rounded-2xl border border-gray-100">
                          <p className="text-[10px] font-bold text-gray-400 uppercase mb-1">{t.totalPremiumPaid || "Total Premium Paid"}</p>
                          <p className="text-lg font-black text-gray-900">₹ {Math.round(totalPremium).toLocaleString()}</p>
                        </div>
                        <div className="p-4 bg-blue-50 rounded-2xl border border-blue-100">
                          <p className="text-[10px] font-bold text-blue-400 uppercase mb-1">{t.netGain || "Net Gain (Above Premium)"}</p>
                          <p className="text-lg font-black text-blue-900">
                            {isTerm ? t.zeroProtection || "Zero (Protection)" : `₹ ${Math.round(maturityEstimate - totalPremium).toLocaleString()}`}
                          </p>
                        </div>
                      </div>

                      <h3 className="font-black text-[10px] uppercase tracking-widest text-gray-400 mb-4">{t.payoutAnalysis || "Payout Analysis"}</h3>
                      <div className="overflow-hidden rounded-st border border-gray-100 mb-6">
                        <table className="w-full text-left text-sm">
                          <thead className="bg-gray-50 uppercase text-[10px] font-bold text-gray-400">
                            <tr>
                              <th className="px-4 py-3">{t.event || "Event"}</th>
                              <th className="px-4 py-3">{t.benefitType || "Benefit Type"}</th>
                              <th className="px-4 py-3">{t.amount || "Amount"}</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                            <tr>
                              <td className="px-4 py-3 font-bold">{t.policyEnd || "Policy End"}</td>
                              <td className="px-4 py-3 text-gray-500">{t.maturitySurvival || "Maturity / Survival"}</td>
                              <td className="px-4 py-3 font-black text-emerald-600">
                                {isTerm ? "₹ 0" : `₹ ${Math.round(maturityEstimate).toLocaleString()}`}
                              </td>
                            </tr>
                            <tr>
                              <td className="px-4 py-3 font-bold">{t.deathBenefitLabel || "Death Benefit"}</td>
                              <td className="px-4 py-3 text-gray-500">{t.deathImmediate || "Death (Immediate)"}</td>
                              <td className="px-4 py-3 font-black text-blue-600">₹ {Math.round(sumAssuredVal).toLocaleString()}</td>
                            </tr>
                            <tr>
                              <td className="px-4 py-3 font-bold">{t.morbidity || "Morbidity"}</td>
                              <td className="px-4 py-3 text-gray-500">{t.disabilityCritical || "Disability / Critical"}</td>
                              <td className="px-4 py-3 text-amber-600 font-bold">{policy.morbidityBenefit?.split(' (')[0] || "Waiver of Premium"}</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>

                      <div className="p-6 bg-amber-50 rounded-3xl border border-amber-100 mb-2">
                        <div className="flex items-start gap-4">
                          <div className="w-10 h-10 bg-amber-100 rounded-xl flex items-center justify-center shrink-0">
                            <Zap className="w-5 h-5 text-amber-600" />
                          </div>
                          <div>
                            <h4 className="font-bold text-amber-900 text-sm">{t.expertVerdict || "Expert Verdict"}</h4>
                            <p className="text-xs text-amber-700 leading-relaxed mt-1">
                              {isTerm 
                                ? (t.pureProtectionDesc || "This is a pure protection plan. Every rupee goes towards buying a massive life cover. High efficiency for family security.")
                                : (t.savingsMaturityDesc || "At age {age}, you pay for {years} years. The CAGR is roughly {cagr}%. Good for low-risk long-term goals.")
                                    .replace("{age}", calcAge.toString())
                                    .replace("{years}", payingTerm.toString())
                                    .replace("{cagr}", (parseFloat(xirr) - 0.5).toFixed(1))}
                            </p>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 text-[10px] font-bold text-gray-400 uppercase tracking-widest justify-center mt-4">
                        <Info className="w-3 h-3" /> {t.illustrativeNotice || "All values are illustrative based on standard industry assumptions."}
                      </div>

                      <AnimatePresence>
                        {showStrategicComparison && (
                          <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-md"
                            onClick={() => setShowStrategicComparison(false)}
                          >
                            <motion.div
                              initial={{ scale: 0.95, y: 20 }}
                              animate={{ scale: 1, y: 0 }}
                              exit={{ scale: 0.95, y: 20 }}
                              className="bg-white w-full max-w-5xl rounded-[32px] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <div className="p-8 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                                <div className="flex items-center gap-4">
                                  <div className="w-12 h-12 bg-blue-600 rounded-2xl flex items-center justify-center shadow-lg shadow-blue-500/20">
                                    <Zap className="w-6 h-6 text-white" />
                                  </div>
                                  <div>
                                    <h3 className="text-2xl font-black text-slate-900">Strategic Wealth Analysis</h3>
                                    <p className="text-sm text-slate-500">Comparing {policy.name} vs. Buy Term & Invest Difference</p>
                                  </div>
                                </div>
                                <button onClick={() => setShowStrategicComparison(false)} className="p-3 hover:bg-white rounded-full transition-all text-slate-400 border border-slate-200">
                                  <X className="w-6 h-6" />
                                </button>
                              </div>

                              <div className="flex-1 overflow-y-auto p-8">
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
                                  <div className="p-6 bg-slate-50 rounded-3xl border border-slate-100 shadow-sm">
                                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em] mb-2 font-mono">Policy Premium</p>
                                    <p className="text-2xl font-black text-slate-900">₹{Math.round(activePremium).toLocaleString('en-IN')}</p>
                                    <p className="text-[10px] text-slate-500 mt-2">Paying for {payingTerm} years (Total Outflow: ₹{Math.round(activePremium * payingTerm).toLocaleString('en-IN')})</p>
                                  </div>
                                  <div className="p-6 bg-blue-50 rounded-3xl border border-blue-100 shadow-sm">
                                    <p className="text-[10px] font-bold text-blue-500 uppercase tracking-[0.2em] mb-2 font-mono">1 Cr Term Insurance</p>
                                    <p className="text-2xl font-black text-blue-900">~ ₹{Math.round(estTermPremium).toLocaleString('en-IN')}</p>
                                    <p className="text-[10px] text-blue-600 mt-2">Annual cost for pure 1Cr protection</p>
                                  </div>
                                  <div className="p-6 bg-emerald-50 rounded-3xl border border-emerald-100 shadow-sm">
                                    <p className="text-[10px] font-bold text-emerald-500 uppercase tracking-[0.2em] mb-2 font-mono">Investable Surplus</p>
                                    <p className="text-2xl font-black text-emerald-900">₹{Math.round(investable).toLocaleString('en-IN')} / Yr</p>
                                    <p className="text-[10px] text-emerald-600 mt-2">
                                      {investable > 0 ? "Compounded wealth difference" : "No surplus available to invest"}
                                    </p>
                                  </div>
                                </div>

                                <div className="rounded-3xl border border-slate-100 overflow-hidden shadow-sm overflow-x-auto font-sans bg-white">
                                  <table className="w-full text-left border-collapse min-w-[1000px]">
                                    <thead className="bg-slate-50">
                                        <tr>
                                          <th className="px-5 py-5 text-[10px] font-black uppercase tracking-widest text-[#64748B] border-b border-slate-100">{t.timePeriod || "Horizon"}</th>
                                          <th className="px-5 py-5 text-[10px] font-black uppercase tracking-widest text-[#64748B] border-b border-slate-100">Total Premium Paid</th>
                                          <th className="px-5 py-5 text-[10px] font-black uppercase tracking-widest text-slate-700 border-b border-slate-100">Scenario A: {policy.name}</th>
                                          <th className="px-5 py-5 text-[10px] font-black uppercase tracking-widest text-emerald-600 border-b border-slate-100">Scenario B: Term + FD (7%)</th>
                                          <th className="px-5 py-5 text-[10px] font-black uppercase tracking-widest text-blue-600 border-b border-slate-100">Scenario C: Term + MF (12%)</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                      {(() => {
                                        const getIRR = (finalVal: number, annualOutflow: number, years: number, depositYears: number) => {
                                          if (finalVal <= 0 || annualOutflow <= 0) return 0;
                                          let low = -0.1, high = 2.0; 
                                          for(let j=0; j<25; j++) {
                                            let mid = (low + high) / 2;
                                            let testFv = calculateFV(annualOutflow, mid, years, depositYears);
                                            if (testFv > finalVal) high = mid;
                                            else low = mid;
                                          }
                                          return low * 100;
                                        };

                                        const timeperiods = [5, 10, 15, 20, 25, 30].filter(y => (calcAge + y) <= 85);

                                        return timeperiods.map((yr) => {
                                          const depositYrs = Math.min(yr, payingTerm);
                                          const totalPaid = activePremium * depositYrs;
                                          
                                          const isULIP = policy.plan_type?.includes("ULIP");
                                          const tradValue = yr >= term 
                                            ? (isULIP ? calculateFV(activePremium, actualXirrRate, yr, depositYrs) : sumAssuredVal * (1 + (0.05 * yr)))
                                            : (isULIP ? calculateFV(activePremium, actualXirrRate * 0.8, yr, depositYrs) : sumAssuredVal * (1 + (0.04 * yr)) * 0.6);
                                          
                                          // Compounding surplus (Premium - Term Premium)
                                          const fdValue = calculateFV(investable, 0.07, yr, depositYrs);
                                          const mfValue = calculateFV(investable, 0.12, yr, depositYrs);
                                          
                                          const tradXirr = getIRR(tradValue, activePremium, yr, depositYrs);
                                          const fdXirr = getIRR(fdValue, activePremium, yr, depositYrs);
                                          const mfXirr = getIRR(mfValue, activePremium, yr, depositYrs);

                                          return (
                                            <tr key={yr} className="hover:bg-slate-50/50 transition-all">
                                              <td className="px-5 py-7">
                                                <div className="flex flex-col">
                                                  <span className="text-base font-black text-slate-900">{yr} Years</span>
                                                  <span className="text-[10px] font-bold text-slate-400 uppercase font-mono">Age {calcAge + yr}</span>
                                                </div>
                                              </td>
                                              <td className="px-5 py-7">
                                                <div className="flex flex-col">
                                                  <span className="text-sm font-bold text-slate-500">₹{Math.round(totalPaid).toLocaleString('en-IN')}</span>
                                                  <span className="text-[9px] text-slate-400 uppercase font-mono tracking-tighter">Total Invested</span>
                                                </div>
                                              </td>
                                              <td className="px-5 py-7">
                                                <div className="flex flex-col">
                                                  <span className="text-base font-black text-slate-700">₹{Math.round(tradValue).toLocaleString('en-IN')}</span>
                                                  <div className="mt-1 flex items-center gap-2">
                                                    <span className="text-[9px] font-bold text-white bg-slate-400 px-2 py-0.5 rounded uppercase">IRR: {tradXirr.toFixed(1)}%</span>
                                                  </div>
                                                </div>
                                              </td>
                                              <td className="px-5 py-7">
                                                <div className="flex flex-col">
                                                  <span className="text-base font-black text-emerald-700">₹{Math.round(fdValue).toLocaleString('en-IN')}</span>
                                                  <div className="flex items-center gap-2 mt-1">
                                                     <span className="text-[9px] font-bold text-white bg-emerald-500 px-2 py-0.5 rounded">IRR: {fdXirr.toFixed(1)}%</span>
                                                     <span className="text-[9px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded">+{Math.round(((fdValue - totalPaid)/totalPaid)*100)}% Gain</span>
                                                  </div>
                                                </div>
                                              </td>
                                              <td className="px-5 py-7">
                                                <div className="flex flex-col">
                                                  <span className="text-base font-black text-blue-700">₹{Math.round(mfValue).toLocaleString('en-IN')}</span>
                                                  <div className="flex items-center gap-2 mt-1">
                                                     <span className="text-[9px] font-bold text-white bg-blue-500 px-2 py-0.5 rounded">IRR: {mfXirr.toFixed(1)}%</span>
                                                     <span className="text-[9px] font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded">+{Math.round(((mfValue - totalPaid)/totalPaid)*100)}% Gain</span>
                                                  </div>
                                                </div>
                                              </td>
                                            </tr>
                                          );
                                        });
                                      })()}
                                    </tbody>
                                  </table>
                                </div>

                                <div className="mt-8 p-6 bg-blue-50 rounded-3xl border border-blue-100 flex items-start gap-4">
                                  <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center shadow-sm">
                                    <Info className="w-5 h-5 text-blue-600" />
                                  </div>
                                  <div>
                                    <h4 className="font-bold text-blue-900 text-sm">Strategic Insight</h4>
                                    <p className="text-xs text-blue-700/80 leading-relaxed mt-1">
                                      The "Buy Term and Invest the Difference" strategy often yields 2x to 3x more wealth over 20-30 years while providing 5-10x higher life coverage (₹1 Cr vs ₹{Math.round(sumAssuredVal/100000)} L). Traditional plans offer safety but lower capital efficiency compared to pure investment in MF at 10% returns.
                                    </p>
                                  </div>
                                </div>
                              </div>
                            </motion.div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                  </div>
                </>
              );
            })()}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
      {/* Navigation */}
      <nav className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-[#F1F1F1] px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2 cursor-pointer" onClick={() => setView("home")}>
          <Shield className="w-8 h-8 text-[#0066FF]" />
          <span className="font-bold text-xl tracking-tight">
            {view === "home" ? "Know Your Insurance" : "KYI"}
          </span>
        </div>
        {view !== "home" && (
          <div className="hidden md:flex gap-8 text-sm font-semibold">
            <button onClick={() => setView("list")} className={cn("hover:text-[#0066FF] transition-all duration-200 border-b-2 border-transparent pb-1", (view === "list" || view === "compare" || view === "detail") && "text-[#0066FF] border-[#0066FF]")}>{t.explore}</button>
            <button onClick={() => setView("recommend")} className={cn("hover:text-[#0066FF] transition-all duration-200 border-b-2 border-transparent pb-1", view === "recommend" && "text-[#0066FF] border-[#0066FF]")}>{t.recommend}</button>
            <button onClick={() => setView("policy-analysis")} className={cn("hover:text-[#0066FF] transition-all duration-200 border-b-2 border-transparent pb-1", view === "policy-analysis" && "text-[#0066FF] border-[#0066FF]")}>{t.knowYourPolicy}</button>
            <button onClick={() => setView("claims")} className={cn("hover:text-[#0066FF] transition-all duration-200 border-b-2 border-transparent pb-1", view === "claims" && "text-[#0066FF] border-[#0066FF]")}>{t.claims}</button>
          </div>
        )}
        <div className="flex items-center gap-6">
          <AnimatePresence>
            {selectedPolicies.length > 0 && view === "list" && (
              <motion.div
                initial={{ opacity: 0, scale: 0.9, y: -10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9, y: -10 }}
                className="flex items-center gap-2"
              >
                <button
                  onClick={() => setView("compare")}
                  className="bg-[#000000] text-white px-6 py-2.5 rounded-xl text-xs font-black shadow-xl shadow-black/10 hover:bg-[#222222] transition-all flex items-center gap-2 border-2 border-white ring-4 ring-black/5"
                >
                  <ArrowLeftRight className="w-4 h-4" />
                  {(t.compare || "Compare").toUpperCase()} ({selectedPolicies.length})
                </button>
                <button
                  onClick={() => setSelectedPolicies([])}
                  className="bg-white text-red-600 p-2.5 rounded-xl text-xs font-black shadow-lg hover:bg-red-50 transition-all border border-red-100 group"
                  title={t.clearSelections || "Clear Selections"}
                >
                  <X className="w-4 h-4 group-hover:scale-125 transition-all" />
                </button>
              </motion.div>
            )}
          </AnimatePresence>
          <div className="relative">
            <select 
              value={language} 
              onChange={(e) => setLanguage(e.target.value)}
              className="appearance-none bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl px-4 py-2 pr-10 text-xs font-semibold focus:ring-2 focus:ring-blue-500/10 cursor-pointer shadow-sm hover:border-blue-200 transition-all"
            >
              <option>English</option>
              <option>Hindi</option>
              <option>Kannada</option>
              <option>Telugu</option>
              <option>Tamil</option>
              <option>Malayalam</option>
              <option>Marathi</option>
            </select>
            <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none opacity-50">
              <ChevronRight className="w-4 h-4 rotate-90" />
            </div>
          </div>
        </div>
      </nav>

      {/* Draggable AI Assistant Button */}
      <motion.div 
        drag
        dragConstraints={{ left: 0, right: 0, top: 0, bottom: 0 }}
        dragElastic={0.1}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        className="fixed bottom-8 right-8 z-[100] cursor-grab active:cursor-grabbing"
      >
        <button 
          onClick={() => setView("analyze")}
          className="bg-[#000000] text-white p-4 rounded-full shadow-2xl flex items-center gap-3 hover:bg-[#222222] transition-all group"
        >
          <div className="bg-blue-600 rounded-full p-2 group-hover:scale-110 transition-transform">
            <MessageSquare className="w-5 h-5 text-white" />
          </div>
          <span className="font-bold text-sm pr-2">{t.assistant}</span>
        </button>
      </motion.div>

      <AnimatePresence>
        {showVideo && (
            <motion.div 
                className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                onClick={() => setShowVideo(false)}
            >
                <div className="bg-zinc-900 border border-white/10 p-8 rounded-3xl max-w-md text-center shadow-2xl">
                    <div className="w-16 h-16 bg-blue-500/20 text-blue-400 rounded-full flex items-center justify-center mx-auto mb-6">
                        <Play className="w-8 h-8" />
                    </div>
                    <h3 className="text-2xl font-bold text-white mb-4">Feature Removed</h3>
                    <p className="text-zinc-400 leading-relaxed">The AI-generated video presentation feature has been removed from this localized build as requested.</p>
                    <button 
                        onClick={() => setShowVideo(false)} 
                        className="mt-8 w-full py-4 bg-white text-black rounded-2xl font-bold"
                    >
                        Close
                    </button>
                </div>
            </motion.div>
        )}

        {showRefTableId && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[400] flex items-center justify-center p-4 bg-black/60 backdrop-blur-md"
            onClick={() => setShowRefTableId(null)}
          >
            <motion.div
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="bg-white w-full max-w-2xl rounded-[32px] shadow-2xl overflow-hidden flex flex-col max-h-[85vh] border border-slate-100"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-8 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-blue-600 rounded-2xl flex items-center justify-center shadow-lg shadow-blue-500/20">
                    <BarChart className="w-6 h-6 text-white" />
                  </div>
                  <div>
                    <h3 className="text-xl font-black text-slate-900">Policy Reference Table</h3>
                    <p className="text-xs text-slate-500">Premium Estimations vs. Age & Sum Assured</p>
                  </div>
                </div>
                <button onClick={() => setShowRefTableId(null)} className="p-3 hover:bg-white rounded-full transition-all text-slate-400 border border-slate-200 shadow-sm">
                  <X className="w-6 h-6" />
                </button>
              </div>
              
              <div className="flex-1 overflow-y-auto p-8">
                <div className="rounded-2xl border border-slate-100 overflow-hidden shadow-sm">
                  <table className="w-full text-left border-collapse">
                    <thead className="bg-slate-50">
                      <tr>
                        <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-slate-400">Entry Age</th>
                        <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-slate-400 text-center">Annual Premium</th>
                        <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-slate-400 text-right">Sum Assured</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {[18, 25, 30, 35, 40, 45, 50, 55].map((age) => {
                        const factor = 1 + (age - 18) * 0.035;
                        const policiesData = policies.find(p => p.id === showRefTableId);
                        const isTerm = policiesData?.plan_type?.includes("Term");
                        const basePrem = policiesData?.basePremium || 25000;
                        const prem = Math.round(basePrem * factor);
                        const sa = isTerm ? 10000000 : Math.round(basePrem * 12 * (1 + (age - 18) * 0.015));

                        return (
                          <tr 
                            key={age} 
                            onClick={() => {
                              setCalcAge(age);
                              setCalcPremium(prem);
                              setCalcSumAssured(sa);
                              setShowRefTableId(null);
                            }}
                            className={cn(
                              "hover:bg-blue-50/50 cursor-pointer transition-all border-b border-slate-50 last:border-0 group",
                              calcAge === age && "bg-blue-50 shadow-inner"
                            )}
                          >
                            <td className="px-6 py-5">
                              <div className="flex items-center gap-3">
                                <div className={cn(
                                  "w-2 h-2 rounded-full transition-all",
                                  calcAge === age ? "bg-blue-500 scale-125" : "bg-slate-200 group-hover:bg-blue-200"
                                )} />
                                <span className={cn("text-sm font-black", calcAge === age ? "text-blue-600" : "text-slate-900")}>
                                  {age} Years
                                </span>
                              </div>
                            </td>
                            <td className="px-6 py-5 text-center">
                              <span className="text-sm font-mono font-bold text-slate-600 italic">₹{Math.round(prem).toLocaleString('en-IN')}</span>
                            </td>
                            <td className="px-6 py-5 text-right font-black text-slate-900 text-sm flex items-center justify-end gap-3">
                              <span>₹{sa >= 10000000 ? `${(sa/10000000).toFixed(1)} Cr` : `${(sa/100000).toFixed(1)} L`}</span>
                              <ChevronRight className={cn("w-4 h-4 transition-all", calcAge === age ? "text-blue-500 translate-x-1" : "text-slate-300 opacity-0 group-hover:opacity-100")} />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                
                <div className="mt-8 p-4 bg-amber-50 rounded-2xl border border-amber-100 flex items-start gap-4">
                  <div className="p-2 bg-amber-100 rounded-lg">
                    <Info className="w-4 h-4 text-amber-600" />
                  </div>
                  <p className="text-[11px] text-amber-700 leading-relaxed font-medium">
                    Disclaimer: These premium rates are indicative and subject to medical underwriting. Actual premium may vary based on lifestyle, occupation, and health history.
                  </p>
                </div>
              </div>
              
              <div className="p-6 bg-slate-50 border-t border-slate-100 flex justify-end">
                <button 
                  onClick={() => setShowRefTableId(null)}
                  className="px-8 py-3 bg-slate-900 text-white rounded-2xl text-xs font-black shadow-lg hover:bg-slate-800 transition-all active:scale-95"
                >
                  GOT IT
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isCompanyPanelOpen && selectedCompany && (
          <>
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsCompanyPanelOpen(false)}
              className="fixed inset-0 bg-black/60 backdrop-blur-md z-[101]"
            />
            <motion.div 
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className="fixed right-0 top-0 h-full w-full md:w-[600px] bg-white z-[102] shadow-2xl overflow-y-auto"
            >
              <div className="p-8">
                <div className="flex justify-between items-center mb-8 bg-white sticky top-0 py-4 z-10 border-b border-gray-100">
                  <div className="flex items-center gap-4">
                    <div className="bg-blue-600 p-3 rounded-2xl shadow-lg shadow-blue-200">
                      <Building className="w-6 h-6 text-white" />
                    </div>
                    <div>
                      <h2 className="text-2xl font-black tracking-tight">{selectedCompany.name}</h2>
                      {selectedCompany.claimsDetail && (
                        <div className="flex items-center gap-1 mt-1">
                          {[...Array(5)].map((_, i) => (
                            <Star 
                              key={i} 
                              className={cn(
                                "w-3 h-3",
                                i < Math.floor(selectedCompany.claimsDetail!.overall_rating) ? "text-yellow-400 fill-yellow-400" : "text-gray-200"
                              )} 
                            />
                          ))}
                          <span className="text-xs font-bold text-gray-400 ml-1">{selectedCompany.claimsDetail.overall_rating}/5 Trust Score</span>
                        </div>
                      )}
                    </div>
                  </div>
                  <button 
                    onClick={() => setIsCompanyPanelOpen(false)}
                    className="p-2 hover:bg-gray-100 rounded-full transition-colors"
                  >
                    <X className="w-6 h-6" />
                  </button>
                </div>

                <div className="space-y-8">
                  <div className="flex justify-between items-center p-4 bg-blue-50 rounded-2xl border border-blue-100">
                    <div className="text-sm font-bold text-blue-900">Summary Dashboard</div>
                    <button 
                      onClick={() => setShowDetailedClaims(!showDetailedClaims)}
                      className="px-4 py-1.5 bg-blue-600 text-white rounded-full text-xs font-bold hover:bg-blue-700 transition-all flex items-center gap-2"
                    >
                      {showDetailedClaims ? "Less Data" : "Detailed View"} 
                      {showDetailedClaims ? <TrendingDown className="w-3 h-3" /> : <TrendingUp className="w-3 h-3" />}
                    </button>
                  </div>

                  {!showDetailedClaims ? (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-8">
                      <section>
                        <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-[0.2em] mb-3">About</h3>
                        <p className="text-[#64748B] text-sm leading-relaxed">{selectedCompany.description}</p>
                      </section>

                      <div className="grid grid-cols-2 gap-4">
                        <div className="p-5 rounded-3xl bg-[#F8FAFC] border border-[#F1F1F1] group hover:border-blue-200 transition-colors">
                          <div className="flex items-center gap-3 mb-2">
                             <div className="p-1.5 bg-green-100 rounded-lg"><TrendingUp className="w-4 h-4 text-green-600" /></div>
                            <span className="text-[10px] font-black text-[#94A3B8] uppercase">Experience</span>
                          </div>
                          <div className="text-2xl font-black">{selectedCompany.yearsInBusiness} Yrs</div>
                        </div>
                        <div className="p-5 rounded-3xl bg-[#F8FAFC] border border-[#F1F1F1] group hover:border-blue-200 transition-colors">
                          <div className="flex items-center gap-3 mb-2">
                            <div className="p-1.5 bg-blue-100 rounded-lg"><Users className="w-4 h-4 text-blue-600" /></div>
                            <span className="text-[10px] font-black text-[#94A3B8] uppercase">Trust Index</span>
                          </div>
                          <div className="text-2xl font-black">{(selectedCompany.customers / 1000000).toFixed(1)}M+</div>
                        </div>
                      </div>

                      {selectedCompany.claimsDetail && (
                         <div className="p-6 rounded-3xl bg-amber-50 border border-amber-100 relative overflow-hidden">
                           <h4 className="flex items-center gap-2 text-xs font-bold text-amber-700 uppercase tracking-widest mb-4">
                             <Shield className="w-4 h-4" /> Why Claims Get Denied
                           </h4>
                           <ul className="space-y-3 mb-8">
                             {selectedCompany.claimsDetail.rejection_reasons.map((r, i) => (
                               <li key={i} className="flex gap-3 text-xs text-amber-900 font-medium">
                                 <div className="shrink-0 mt-1 w-1.5 h-1.5 rounded-full bg-amber-400" />
                                 {r}
                               </li>
                             ))}
                           </ul>
                           
                           <div className="absolute bottom-4 right-4 focus-within:z-10">
                               <button 
                                 onClick={() => setShowDosPanel(true)}
                                 className="bg-amber-600 text-white px-4 py-2 rounded-xl text-[10px] font-bold shadow-lg shadow-amber-200 flex items-center gap-1.5 hover:bg-amber-700 transition-all"
                               >
                                 <CheckCircle className="w-3 h-3" /> DOs to avoid claim rejection
                               </button>
                             </div>
                         </div>
                      )}
                    </motion.div>
                  ) : (
                    <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="space-y-8">
                      {selectedCompany.claimsDetail && (
                        <>
                          <div className="grid grid-cols-2 gap-4">
                            <div className="p-6 rounded-3xl bg-zinc-900 text-white col-span-2 overflow-hidden relative">
                              <div className="absolute top-0 right-0 p-8 opacity-10"><Zap className="w-24 h-24" /></div>
                              <h4 className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-6">Social Sentiment Analysis</h4>
                              <div className="grid grid-cols-2 gap-8 relative z-10">
                                <div className="bg-white/5 p-4 rounded-2xl border border-white/10">
                                  <div className="flex items-center justify-between mb-3">
                                    <div className="flex items-center gap-2">
                                      <div className="w-8 h-8 bg-black rounded-full flex items-center justify-center border border-white/20">
                                        <X className="w-4 h-4 text-white" />
                                      </div>
                                      <div>
                                        <div className="text-[10px] font-bold text-white leading-none">X.com Insight</div>
                                        <div className="text-[8px] text-zinc-500 font-bold uppercase tracking-wider">Twitter Sentiment</div>
                                      </div>
                                    </div>
                                    <span className="text-xs font-black text-blue-400">{selectedCompany.claimsDetail.social_sentiment_x.rating}/5</span>
                                  </div>
                                  <p className="text-[11px] text-zinc-300 leading-relaxed italic border-l-2 border-blue-500/30 pl-3">
                                    "{selectedCompany.claimsDetail.social_sentiment_x.positive}"
                                  </p>
                                </div>
                                <div className="bg-white/5 p-4 rounded-2xl border border-white/10">
                                  <div className="flex items-center justify-between mb-3">
                                    <div className="flex items-center gap-2">
                                      <div className="w-8 h-8 bg-[#FF4500]/20 rounded-full flex items-center justify-center border border-[#FF4500]/40">
                                        <span className="text-[#FF4500] font-black text-xs">r/</span>
                                      </div>
                                      <div>
                                        <div className="text-[10px] font-bold text-white leading-none">Reddit Community</div>
                                        <div className="text-[8px] text-zinc-500 font-bold uppercase tracking-wider">User Experience</div>
                                      </div>
                                    </div>
                                    <span className="text-xs font-black text-orange-400">{selectedCompany.claimsDetail.social_sentiment_reddit.rating}/5</span>
                                  </div>
                                  <p className="text-[11px] text-zinc-300 leading-relaxed italic border-l-2 border-orange-500/30 pl-3">
                                    "{selectedCompany.claimsDetail.social_sentiment_reddit.positive}"
                                  </p>
                                </div>
                              </div>
                            </div>
                          </div>

                          <div className="grid md:grid-cols-2 gap-4">
                            <div className="p-6 rounded-3xl border border-red-100 bg-red-50/30">
                              <h4 className="text-[10px] font-bold text-red-600 uppercase tracking-widest mb-3">Major Complaints</h4>
                              <p className="text-[11px] text-red-900 font-medium leading-relaxed italic">
                                "{selectedCompany.claimsDetail.major_complaints}"
                              </p>
                            </div>
                            <div className="p-6 rounded-3xl border border-emerald-100 bg-emerald-50/30">
                              <h4 className="text-[10px] font-bold text-emerald-600 uppercase tracking-widest mb-3">Good Reviews</h4>
                              <p className="text-[11px] text-emerald-900 font-medium leading-relaxed italic">
                                "{selectedCompany.claimsDetail.good_reviews}"
                              </p>
                            </div>
                          </div>

                          <section className="p-6 rounded-3xl bg-zinc-50 border border-zinc-200">
                             <div className="flex justify-between items-center mb-6">
                               <h4 className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Process Efficiency</h4>
                               <span className="text-xl font-black italic text-blue-600">{selectedCompany.claimsDetail.easiness_score}/5</span>
                             </div>
                             <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
                               <motion.div 
                                 initial={{ width: 0 }}
                                 animate={{ width: `${(selectedCompany.claimsDetail.easiness_score / 5) * 100}%` }}
                                 className="h-full bg-blue-600"
                               />
                             </div>
                             <p className="mt-4 text-[11px] text-gray-600 font-medium leading-relaxed">
                               <strong className="text-gray-900 uppercase">Analysis:</strong> {selectedCompany.claimsDetail.shortcomings}
                             </p>
                          </section>

                          <button 
                            onClick={() => setShowDosPanel(true)}
                            className="w-full mt-2 bg-amber-600 text-white p-4 rounded-3xl text-sm font-bold shadow-xl shadow-amber-100 flex items-center justify-center gap-2 hover:bg-amber-700 transition-all font-bold"
                          >
                            <CheckCircle className="w-4 h-4" /> {t.dosButton || "DOs to avoid claim rejection"}
                          </button>
                        </>
                      )}

                    </motion.div>
                  )}
                </div>

                <AnimatePresence>
                  {showDosPanel && (
                    <motion.div 
                      initial={{ y: 20, opacity: 0 }}
                      animate={{ y: 0, opacity: 1 }}
                      exit={{ y: 20, opacity: 0 }}
                      className="mt-6 p-6 rounded-3xl bg-blue-600 text-white shadow-xl shadow-blue-200"
                    >
                      <div className="flex justify-between items-center mb-6">
                        <h4 className="font-bold flex items-center gap-2">
                          <Zap className="w-4 h-4 text-yellow-400 fill-yellow-400" /> {t.avoidRejectionHead || "Actionable DOs"}
                        </h4>
                        <button onClick={() => setShowDosPanel(false)} className="p-1 hover:bg-white/20 rounded-lg">
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                      <div className="space-y-4">
                        {selectedCompany.claimsDetail?.dos_to_avoid_rejection.map((item: string, i: number) => (
                          <div key={i} className="flex gap-3 items-start">
                            <div className="w-5 h-5 rounded-full bg-white/20 flex items-center justify-center shrink-0 text-[10px] font-bold">
                              {i + 1}
                            </div>
                            <p className="text-sm font-medium leading-relaxed">{item}</p>
                          </div>
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>


                <div className="mt-12 text-[10px] text-[#94A3B8] leading-relaxed italic border-t border-gray-100 pt-8 text-center">
                  Aggregated data from IRDAI, X (formerly Twitter), and Reddit communities. Sentiment scores are AI-weighted based on 2024 discussion volume. Rejection data is normalized against premium income.
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <main className={cn("max-w-6xl mx-auto px-6 py-12", view === "home" && "max-w-7xl")}>
        <AnimatePresence mode="wait">
          {view === "home" && (
            <motion.div
              key="home"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="space-y-12 py-10"
            >
              <div className="text-center max-w-3xl mx-auto space-y-4">
                <motion.div 
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  className="bg-blue-600 text-white w-16 h-16 rounded-3xl flex items-center justify-center mx-auto shadow-2xl mb-6 shadow-blue-200"
                >
                  <Shield className="w-8 h-8" />
                </motion.div>
                <h1 className="text-5xl md:text-7xl font-black tracking-tight text-[#0F172A]">Know your <span className="text-blue-600">insurance</span></h1>
                <p className="text-xl text-[#64748B] font-medium leading-relaxed">
                  Your comprehensive insurance assistant to help you navigate through complex policies and claim processes with ease.
                </p>
              </div>

              <div className="grid md:grid-cols-2 gap-8 max-w-5xl mx-auto">
                {/* Health Insurance Card */}
                <motion.div
                  whileHover={{ y: -8, scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => {
                    setInsuranceType("health");
                    setView("list");
                  }}
                  className="relative group cursor-pointer bg-white p-10 rounded-[48px] border border-blue-100 shadow-[0_32px_64px_-16px_rgba(59,130,246,0.12)] flex flex-col justify-between overflow-hidden"
                >
                  <div className="absolute top-0 right-0 p-12 opacity-5 -rotate-12 group-hover:rotate-0 transition-transform duration-500">
                    <Activity className="w-48 h-48 text-blue-600" />
                  </div>
                  
                  <div className="relative z-10">
                    <div className="bg-blue-50 w-16 h-16 rounded-2xl flex items-center justify-center mb-10 group-hover:bg-blue-600 transition-colors duration-300">
                      <Activity className="w-8 h-8 text-blue-600 group-hover:text-white transition-colors" />
                    </div>
                    <h2 className="text-4xl font-black text-[#0F172A] mb-4">Health Insurance</h2>
                    <p className="text-[#64748B] font-medium text-lg leading-relaxed mb-10">
                      Explore health policies, analyze fine print, compare coverage, and understand IRDAI compliance for claim disputes.
                    </p>
                  </div>

                  <div className="relative z-10 flex items-center justify-between invisible">
                    <div className="text-blue-600 font-black uppercase tracking-widest text-xs flex items-center gap-2 group-hover:translate-x-2 transition-transform">
                      Explore Policies <ChevronRight className="w-4 h-4" />
                    </div>
                  </div>
                </motion.div>

                {/* Life Insurance Card */}
                <motion.div
                  whileHover={{ y: -8, scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => {
                    setInsuranceType("life");
                    setView("list");
                  }}
                  className="relative group cursor-pointer bg-[#0F172A] p-10 rounded-[48px] border border-zinc-800 shadow-2xl flex flex-col justify-between overflow-hidden"
                >
                  <div className="absolute top-0 right-0 p-12 opacity-5 -rotate-12 group-hover:rotate-0 transition-transform duration-500">
                    <Star className="w-48 h-48 text-emerald-500" />
                  </div>
                  
                  <div className="relative z-10">
                    <div className="bg-zinc-800 w-16 h-16 rounded-2xl flex items-center justify-center mb-10 group-hover:bg-emerald-500 transition-colors duration-300">
                      <Shield className="w-8 h-8 text-emerald-500 group-hover:text-white transition-colors" />
                    </div>
                    <h2 className="text-4xl font-black text-white mb-4">Life Insurance</h2>
                    <p className="text-zinc-400 font-medium text-lg leading-relaxed mb-10">
                      Compare Term plans, Endowment policies, and ULIPs. Deep analysis of bonuses, maturity benefits, and exclusion clauses.
                    </p>
                  </div>

                  <div className="relative z-10 flex items-center justify-between invisible">
                    <div className="text-emerald-500 font-black uppercase tracking-widest text-xs flex items-center gap-2 group-hover:translate-x-2 transition-transform">
                       Analyze Plans <ChevronRight className="w-4 h-4" />
                    </div>
                  </div>
                </motion.div>
              </div>

              <div className="max-w-4xl mx-auto pt-12 border-t border-gray-100">
                <div className="flex flex-col md:flex-row items-center justify-between gap-8 text-[#94A3B8] text-[10px] uppercase font-black tracking-widest">
                  <div className="flex gap-12">
                    <div className="flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-blue-500" /> Secure Database</div>
                    <div className="flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-emerald-500" /> IRDAI Compliant</div>
                    <div className="flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-orange-500" /> Verified Data</div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {view === "life-insurance" && (
            <motion.div
              key="life-insurance"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 1.05 }}
              className="min-h-[70vh] flex flex-col items-center justify-center text-center space-y-8"
            >
              <div className="w-32 h-32 bg-zinc-900 rounded-[40px] flex items-center justify-center relative shadow-2xl overflow-hidden border border-zinc-800">
                <motion.div 
                  animate={{ 
                    scale: [1, 1.2, 1],
                    rotate: [0, 180, 360]
                  }}
                  transition={{ duration: 10, repeat: Infinity, ease: "linear" }}
                  className="absolute inset-0 bg-gradient-to-tr from-emerald-500/20 to-transparent" 
                />
                <Shield className="w-16 h-16 text-emerald-500 relative z-10" />
              </div>
              
              <div className="max-w-xl space-y-4">
                <h1 className="text-5xl font-black tracking-tight">Life Insurance Portal</h1>
                <p className="text-xl text-[#64748B] font-medium leading-relaxed">
                  We are currently integrating new data sources to analyze Life Insurance policies, Term Plans, and ULIPs.
                </p>
              </div>

              <div className="flex gap-4">
                <button 
                  onClick={() => setView("home")}
                  className="px-8 py-4 bg-[#F8FAFC] text-[#0F172A] rounded-2xl font-black uppercase tracking-widest text-xs hover:bg-gray-100 transition-all border border-gray-200"
                >
                  <ArrowLeft className="w-4 h-4 inline mr-2" /> Back Home
                </button>
                <div className="px-8 py-4 bg-[#0F172A] text-white rounded-2xl font-black uppercase tracking-widest text-xs flex items-center gap-2">
                  <Zap className="w-4 h-4 text-yellow-400" /> Coming Soon
                </div>
              </div>

              <div className="pt-12 grid grid-cols-3 gap-12 text-center">
                <div>
                   <div className="text-2xl font-black text-[#0F172A] mb-1">Term</div>
                   <div className="text-[10px] font-bold text-[#94A3B8] uppercase">Analysis</div>
                </div>
                <div>
                   <div className="text-2xl font-black text-[#0F172A] mb-1">ULIP</div>
                   <div className="text-[10px] font-bold text-[#94A3B8] uppercase">Comparisons</div>
                </div>
                <div>
                   <div className="text-2xl font-black text-[#0F172A] mb-1">MWP</div>
                   <div className="text-[10px] font-bold text-[#94A3B8] uppercase">Guidance</div>
                </div>
              </div>
            </motion.div>
          )}

          {view === "list" && (
            <motion.div
              key="list"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-8"
            >
              <div className="text-center max-w-2xl mx-auto mb-16">
                <h1 className="text-4xl font-bold tracking-tight mb-4">
                  {insuranceType === "health" ? t.heroTitle : "Life Protection Explorer"}
                </h1>
                <p className="text-[#64748B] text-lg">
                  {insuranceType === "health" ? t.heroSub : "Navigate through Term plans, Endowment policies and ULIPs with AI-powered clarity on maturity and death benefits."}
                </p>
                {translating && <div className="mt-4 text-sm text-blue-500 font-medium animate-pulse">Translating policies...</div>}
              </div>

              {insuranceType === "life" && (
                <div className="flex flex-wrap justify-center gap-3 mb-10 overflow-x-auto pb-2 scrollbar-none">
                  {["All", "Term Insurance", "Endowment / Savings", "ULIP", "Money Back"].map((cat) => (
                    <button
                      key={cat}
                      onClick={() => setLifeCategory(cat as any)}
                      className={cn(
                        "whitespace-nowrap px-6 py-3 rounded-2xl text-xs font-black uppercase tracking-widest transition-all border shrink-0",
                        lifeCategory === cat 
                          ? "bg-emerald-600 border-emerald-600 text-white shadow-xl shadow-emerald-200" 
                          : "bg-white border-[#F1F1F1] text-[#94A3B8] hover:border-emerald-200 hover:text-emerald-600"
                      )}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              )}

              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
                {(translatedPolicies.length > 0 ? translatedPolicies : policies)
                  .filter(p => insuranceType === "health" || lifeCategory === "All" || p.plan_type === lifeCategory)
                  .map((policy) => (
                  <motion.div
                    key={policy.id}
                    layoutId={`card-${policy.id}`}
                    className={cn(
                      "p-6 rounded-3xl bg-white border border-[#F1F1F1] hover:border-[#0066FF] hover:shadow-xl hover:shadow-blue-500/5 transition-all group flex flex-col justify-between",
                      insuranceType === "life" && "hover:border-emerald-500 hover:shadow-emerald-500/5"
                    )}
                  >
                    <div>
                      <div className="flex justify-between items-start mb-4">
                        <div className={cn(
                          "rounded-xl p-3",
                          insuranceType === "health" ? "bg-[#F8FAFC] text-[#0066FF]" : "bg-emerald-50 text-emerald-600"
                        )}>
                          {insuranceType === "health" ? <Activity className="w-6 h-6" /> : <Shield className="w-6 h-6" />}
                        </div>
                        <div className="flex items-center gap-2">
                          <button 
                             onClick={() => speak(`${policy.name} by ${policy.company}. ${policy.summary}`)}
                             className="p-2 hover:bg-gray-100 rounded-xl text-gray-400 hover:text-gray-600 transition-all"
                          >
                            <Volume2 className="w-4 h-4" />
                          </button>
                          <button 
                            onClick={() => toggleCompare(policy.id)}
                            className={cn(
                              "p-2 rounded-full border transition-all",
                              selectedPolicies.includes(policy.id) 
                                ? "bg-blue-50 border-blue-200 text-blue-600" 
                                : "border-[#F1F1F1] text-[#94A3B8] hover:border-blue-200 hover:text-blue-500"
                            )}
                          >
                            {selectedPolicies.includes(policy.id) ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                          </button>
                        </div>
                      </div>
                      <h3 className="text-xs font-semibold uppercase tracking-wider text-[#64748B] mb-1">
                        <button 
                          onClick={() => handleCompanyClick(policy.company)}
                          className="hover:text-blue-600 hover:underline flex items-center gap-1"
                        >
                          {policy.company} <ExternalLink className="w-3 h-3" />
                        </button>
                      </h3>
                      <h2 className="text-xl font-bold mb-3">{policy.name}</h2>
                      <p className="text-[#64748B] text-sm line-clamp-3 mb-6 leading-relaxed">{policy.summary}</p>
                    </div>
                    
                    <div className="space-y-4 pt-4 border-t border-[#F8FAFC]">
                      <div className="flex items-center justify-between text-sm">
                        {insuranceType === "health" ? (
                          <>
                            <span className="text-[#94A3B8] flex items-center gap-1"><Hospital className="w-4 h-4"/> {t.hospitals}</span>
                            <span className="font-semibold">{policy.networkHospitals}+</span>
                          </>
                        ) : (
                          <>
                            <span className="text-[#94A3B8] flex items-center gap-1"><Shield className="w-4 h-4"/> {t.planType}</span>
                            <span className="font-semibold">{policy.plan_type}</span>
                          </>
                        )}
                      </div>
                      
                      {insuranceType === "life" && (
                        <>
                          <div className="flex items-start justify-between text-sm border-t border-[#F8FAFC] pt-3">
                            <span className="text-[#94A3B8]">{t.maturityBenefit}</span>
                            <span className="font-medium text-right max-w-[150px]">{policy.maturityBenefit}</span>
                          </div>
                          <div className="flex items-start justify-between text-sm">
                            <span className="text-[#94A3B8]">{t.morbidityBenefit}</span>
                            <span className="font-medium text-right max-w-[150px]">{policy.morbidityBenefit}</span>
                          </div>
                        </>
                      )}

                      <div className="flex items-center justify-between text-sm border-t border-[#F8FAFC] pt-3">
                        <span className="text-[#94A3B8]">{insuranceType === "health" ? t.premium : t.sumAssured}</span>
                        <div className="text-right">
                          <span className="font-semibold text-[#059669]">
                            {insuranceType === "health" ? `₹${policy.premiumRange}` : `₹${policy.sumAssured}`}
                          </span>
                        </div>
                      </div>

                      <div className="flex flex-col gap-2">
                        <button 
                           onClick={() => setShowRidersId(policy.id)}
                           className="w-full py-2.5 rounded-2xl bg-emerald-50 text-emerald-600 text-[10px] font-black uppercase tracking-widest hover:bg-emerald-100 transition-all flex items-center justify-center gap-2 border border-emerald-100"
                        >
                          <PlusCircle className="w-3.5 h-3.5" /> Riders {selectedRiders[policy.id]?.length > 0 && `(${selectedRiders[policy.id].length})`}
                        </button>

                        <div className="flex gap-2">
                          <button 
                             onClick={() => setShowComparisonTableId(policy.id)}
                             className="flex-1 py-2.5 rounded-2xl bg-slate-50 text-slate-500 text-[10px] font-black uppercase tracking-widest hover:bg-slate-100 transition-all flex items-center justify-center gap-2 border border-slate-100"
                          >
                            <BarChart className="w-3.5 h-3.5" /> Policy Table
                          </button>
                          
                          {insuranceType === "life" && (
                            <button 
                              onClick={() => setShowCalculatorId(policy.id)}
                              className="flex-1 py-2.5 rounded-2xl bg-blue-50 text-blue-600 text-[10px] font-black uppercase tracking-widest hover:bg-blue-100 transition-all flex items-center justify-center gap-2 border border-blue-100"
                            >
                              <TrendingUp className="w-3.5 h-3.5" /> Returns Calculator
                            </button>
                          )}
                        </div>

                        <button 
                          onClick={() => { setActivePolicyId(policy.id); setView("analyze"); }}
                          className="w-full py-3 rounded-2xl bg-[#F8FAFC] text-sm font-semibold hover:bg-blue-50 hover:text-blue-600 transition-all flex items-center justify-center gap-2"
                        >
                          {t.explain} <ChevronRight className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            </motion.div>
          )}

          {view === "compare" && (
            <motion.div
              key="compare"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <div className="flex items-center justify-between mb-12 bg-white sticky top-[73px] z-20 py-4 border-b border-[#F1F1F1]">
                <div>
                  <h1 className="text-3xl font-black tracking-tight">{t.compare}</h1>
                  <p className="text-xs text-[#94A3B8] font-bold uppercase tracking-widest mt-1">Side-by-side Analysis</p>
                </div>
                <div className="flex items-center gap-4">
                  <button 
                    onClick={() => setView("list")} 
                    className="flex items-center gap-2 bg-[#F8FAFC] px-6 py-3 rounded-2xl text-sm font-black text-[#64748B] hover:bg-gray-100 transition-all border border-gray-200 shadow-sm"
                  >
                    <ArrowLeft className="w-4 h-4" />
                    {t.back}
                  </button>
                    <button 
                      onClick={() => { setSelectedPolicies([]); setView("list"); }}
                      className="flex items-center gap-2 bg-red-50 px-6 py-3 rounded-2xl text-xs font-black text-red-600 hover:bg-red-100 transition-all border border-red-100 shadow-sm uppercase tracking-widest"
                    >
                      <X className="w-4 h-4" />
                      Clear All
                    </button>
                </div>
              </div>
              
              {selectedPolicies.length === 0 ? (
                <div className="text-center py-24 bg-white rounded-3xl border border-dashed border-[#E2E8F0]">
                  <p className="text-[#64748B] mb-4">No policies selected.</p>
                  <button onClick={() => setView("list")} className="bg-black text-white px-6 py-2 rounded-full text-sm">{t.explore}</button>
                </div>
              ) : (
                <div className="overflow-x-auto pb-4">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr>
                        <th className="p-4 border-b border-[#F1F1F1] text-[#94A3B8] font-medium w-48">{t.feature}</th>
                        {selectedPolicies.map(id => {
                          const p = translatedPolicies.find(p => p.id === id)!;
                          if (!p) return null;
                          return (
                            <th key={id} className="p-4 border-b border-[#F1F1F1] w-64">
                              <div className="font-bold text-lg">{p.name}</div>
                              <div className="text-[10px] text-[#64748B] uppercase">{p.company}</div>
                            </th>
                          );
                        })}
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="hover:bg-[#F8FAFC]">
                        <td className="p-4 border-b border-[#F1F1F1] text-sm font-medium">{t.premium} (Yearly)</td>
                        {selectedPolicies.map(id => <td key={id} className="p-4 border-b border-[#F1F1F1] text-sm font-semibold text-[#059669]">₹{translatedPolicies.find(p => p.id === id)?.premiumRange}</td>)}
                      </tr>
                      {insuranceType === "health" ? (
                        <>
                          <tr className="hover:bg-[#F8FAFC]">
                            <td className="p-4 border-b border-[#F1F1F1] text-sm font-medium">{t.hospitals}</td>
                            {selectedPolicies.map(id => <td key={id} className="p-4 border-b border-[#F1F1F1] text-sm">{translatedPolicies.find(p => p.id === id)?.networkHospitals}+</td>)}
                          </tr>
                          <tr className="hover:bg-[#F8FAFC]">
                            <td className="p-4 border-b border-[#F1F1F1] text-sm font-medium">Room Rent Limit</td>
                            {selectedPolicies.map(id => <td key={id} className="p-4 border-b border-[#F1F1F1] text-sm whitespace-pre-line">{translatedPolicies.find(p => p.id === id)?.roomRentLimit}</td>)}
                          </tr>
                          <tr className="hover:bg-[#F8FAFC]">
                            <td className="p-4 border-b border-[#F1F1F1] text-sm font-medium">Waiting Period (PED)</td>
                            {selectedPolicies.map(id => <td key={id} className="p-4 border-b border-[#F1F1F1] text-sm">{translatedPolicies.find(p => p.id === id)?.waitingPeriodPED}</td>)}
                          </tr>
                          <tr className="hover:bg-[#F8FAFC]">
                            <td className="p-4 border-b border-[#F1F1F1] text-sm font-medium">Co-payment</td>
                            {selectedPolicies.map(id => <td key={id} className="p-4 border-b border-[#F1F1F1] text-sm italic">{translatedPolicies.find(p => p.id === id)?.coPay}</td>)}
                          </tr>
                        </>
                      ) : (
                        <>
                          <tr className="hover:bg-[#F8FAFC]">
                            <td className="p-4 border-b border-[#F1F1F1] text-sm font-medium">{t.planType}</td>
                            {selectedPolicies.map(id => <td key={id} className="p-4 border-b border-[#F1F1F1] text-sm">{translatedPolicies.find(p => p.id === id)?.plan_type}</td>)}
                          </tr>
                          <tr className="hover:bg-[#F8FAFC]">
                            <td className="p-4 border-b border-[#F1F1F1] text-sm font-medium">{t.sumAssured}</td>
                            {selectedPolicies.map(id => <td key={id} className="p-4 border-b border-[#F1F1F1] text-sm font-semibold text-blue-600">₹{translatedPolicies.find(p => p.id === id)?.sumAssured}</td>)}
                          </tr>
                          <tr className="hover:bg-[#F8FAFC]">
                            <td className="p-4 border-b border-[#F1F1F1] text-sm font-medium">{t.maturityBenefit}</td>
                            {selectedPolicies.map(id => <td key={id} className="p-4 border-b border-[#F1F1F1] text-sm whitespace-pre-line">{translatedPolicies.find(p => p.id === id)?.maturityBenefit}</td>)}
                          </tr>
                          <tr className="hover:bg-[#F8FAFC]">
                            <td className="p-4 border-b border-[#F1F1F1] text-sm font-medium">{t.deathBenefit}</td>
                            {selectedPolicies.map(id => <td key={id} className="p-4 border-b border-[#F1F1F1] text-sm whitespace-pre-line">{translatedPolicies.find(p => p.id === id)?.deathBenefit}</td>)}
                          </tr>
                          <tr className="hover:bg-[#F8FAFC]">
                            <td className="p-4 border-b border-[#F1F1F1] text-sm font-medium">{t.morbidityBenefit}</td>
                            {selectedPolicies.map(id => <td key={id} className="p-4 border-b border-[#F1F1F1] text-sm whitespace-pre-line">{translatedPolicies.find(p => p.id === id)?.morbidityBenefit}</td>)}
                          </tr>
                          <tr className="hover:bg-[#F8FAFC]">
                            <td className="p-4 border-b border-[#F1F1F1] text-sm font-medium">{t.policyTerm} / {t.premiumTerm}</td>
                            {selectedPolicies.map(id => (
                              <td key={id} className="p-4 border-b border-[#F1F1F1] text-sm">
                                {translatedPolicies.find(p => p.id === id)?.policyTerm} / {translatedPolicies.find(p => p.id === id)?.premiumTerm}
                              </td>
                            ))}
                          </tr>
                          <tr className="hover:bg-[#F8FAFC]">
                            <td className="p-4 border-b border-[#F1F1F1] text-sm font-medium">{t.riders}</td>
                            {selectedPolicies.map(id => (
                              <td key={id} className="p-4 border-b border-[#F1F1F1] text-xs space-y-1">
                                {translatedPolicies.find(p => p.id === id)?.riders?.map((r, i) => (
                                  <div key={i} className="flex items-center gap-2">
                                    <Plus className="w-2 h-2 text-emerald-500" />
                                    {r}
                                  </div>
                                ))}
                              </td>
                            ))}
                          </tr>
                        </>
                      )}
                      <tr className="hover:bg-[#F8FAFC]">
                        <td className="p-4 border-b border-[#F1F1F1] text-sm font-medium align-top">{insuranceType === "health" ? "Top Benefits" : "Key Coverage"}</td>
                        {selectedPolicies.map(id => (
                          <td key={id} className="p-4 border-b border-[#F1F1F1] text-sm space-y-2">
                            {insuranceType === "health" ? (
                              translatedPolicies.find(p => p.id === id)?.coverage?.map((c, i) => (
                                <div key={i} className="flex items-center gap-2">
                                  <div className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                                  {c}
                                </div>
                              ))
                            ) : (
                              <div className="text-gray-600 italic">Full product documentation available</div>
                            )}
                          </td>
                        ))}
                      </tr>
                      {insuranceType === "health" && (
                        <>
                          <tr className="hover:bg-[#F8FAFC]">
                            <td className="p-4 border-b border-[#F1F1F1] text-sm font-medium">Pre-Hospitalization</td>
                            {selectedPolicies.map(id => <td key={id} className="p-4 border-b border-[#F1F1F1] text-sm">{translatedPolicies.find(p => p.id === id)?.preHosp}</td>)}
                          </tr>
                          <tr className="hover:bg-[#F8FAFC]">
                            <td className="p-4 border-b border-[#F1F1F1] text-sm font-medium">Post-Hospitalization</td>
                            {selectedPolicies.map(id => <td key={id} className="p-4 border-b border-[#F1F1F1] text-sm">{translatedPolicies.find(p => p.id === id)?.postHosp}</td>)}
                          </tr>
                          <tr className="hover:bg-[#F8FAFC]">
                            <td className="p-4 border-b border-[#F1F1F1] text-sm font-medium">Day Care Treatments</td>
                            {selectedPolicies.map(id => <td key={id} className="p-4 border-b border-[#F1F1F1] text-sm">{translatedPolicies.find(p => p.id === id)?.dayCare}</td>)}
                          </tr>
                          <tr className="hover:bg-[#F8FAFC]">
                            <td className="p-4 border-b border-[#F1F1F1] text-sm font-medium">At-home (Domiciliary)</td>
                            {selectedPolicies.map(id => <td key={id} className="p-4 border-b border-[#F1F1F1] text-sm">{translatedPolicies.find(p => p.id === id)?.domiciliary}</td>)}
                          </tr>
                          <tr className="hover:bg-[#F8FAFC]">
                            <td className="p-4 border-b border-[#F1F1F1] text-sm font-medium">Ambulance Charges</td>
                            {selectedPolicies.map(id => <td key={id} className="p-4 border-b border-[#F1F1F1] text-sm">{translatedPolicies.find(p => p.id === id)?.ambulance}</td>)}
                          </tr>
                          <tr className="hover:bg-[#F8FAFC]">
                            <td className="p-4 border-b border-[#F1F1F1] text-sm font-medium">Non-Consumables Cover</td>
                            {selectedPolicies.map(id => <td key={id} className="p-4 border-b border-[#F1F1F1] text-sm">{translatedPolicies.find(p => p.id === id)?.nonConsumables}</td>)}
                          </tr>
                          <tr className="hover:bg-[#F8FAFC]">
                            <td className="p-4 border-b border-[#F1F1F1] text-sm font-medium">Renewal Discounts</td>
                            {selectedPolicies.map(id => <td key={id} className="p-4 border-b border-[#F1F1F1] text-sm">{translatedPolicies.find(p => p.id === id)?.renewalDiscount}</td>)}
                          </tr>
                          <tr className="hover:bg-[#F8FAFC]">
                            <td className="p-4 border-b border-[#F1F1F1] text-sm font-medium">OPD Consultation</td>
                            {selectedPolicies.map(id => <td key={id} className="p-4 border-b border-[#F1F1F1] text-sm">{translatedPolicies.find(p => p.id === id)?.opd}</td>)}
                          </tr>
                          <tr className="hover:bg-[#F8FAFC]">
                            <td className="p-4 border-b border-[#F1F1F1] text-sm font-medium">AYUSH (Alternate Medicine)</td>
                            {selectedPolicies.map(id => <td key={id} className="p-4 border-b border-[#F1F1F1] text-sm">{translatedPolicies.find(p => p.id === id)?.ayush}</td>)}
                          </tr>
                          <tr className="hover:bg-[#F8FAFC]">
                            <td className="p-4 border-b border-[#F1F1F1] text-sm font-medium">Organ Donor Coverage</td>
                            {selectedPolicies.map(id => <td key={id} className="p-4 border-b border-[#F1F1F1] text-sm">{translatedPolicies.find(p => p.id === id)?.organDonor}</td>)}
                          </tr>
                        </>
                      )}
                      <tr className="hover:bg-[#F8FAFC]">
                        <td className="p-4 border-b border-[#F1F1F1] text-sm font-medium align-top text-red-600">{t.criticalExclusionsHead}</td>
                        {selectedPolicies.map(id => (
                          <td key={id} className="p-4 border-b border-[#F1F1F1] text-sm space-y-2">
                            {translatedPolicies.find(p => p.id === id)?.criticalExclusions?.map((ex, i) => (
                              <div key={i} className="flex items-center gap-2 text-red-900 opacity-80">
                                <X className="w-3 h-3" />
                                {ex}
                              </div>
                            ))}
                          </td>
                        ))}
                      </tr>
                      <tr className="hover:bg-[#F1F5F9]/50">
                        <td className="p-4 border-b border-[#F1F1F1] text-sm font-bold align-top text-orange-600">{t.nuances}</td>
                        {selectedPolicies.map(id => (
                          <td key={id} className="p-4 border-b border-[#F1F1F1] text-xs space-y-3">
                            {translatedPolicies.find(p => p.id === id)?.redFlags?.map((flag, i) => (
                              <div key={i} className="p-2 rounded-lg bg-orange-50 border border-orange-100 text-orange-950 font-medium">
                                {flag}
                              </div>
                            ))}
                          </td>
                        ))}
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
            </motion.div>
          )}

          {view === "recommend" && (
            <motion.div
              key="recommend"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="max-w-3xl mx-auto"
            >
              <h1 className="text-3xl font-bold mb-8">{t.recommend}</h1>
              <div className="bg-white p-8 rounded-3xl border border-[#F1F1F1] shadow-sm mb-8">
                <h2 className="text-lg font-bold mb-6 flex items-center gap-2"><User className="w-5 h-5 text-[#0066FF]"/> {t.profileTitle}</h2>
                <div className="grid md:grid-cols-3 gap-6 mb-8 text-sm">
                      <div>
                        <label className="block text-[#94A3B8] mb-1 italic">{t.age}</label>
                        <input 
                          type="number" 
                          value={profile.age || ""} 
                          placeholder="e.g. 30"
                          onChange={(e) => {
                            const val = e.target.value === "" ? 0 : parseInt(e.target.value);
                            setProfile({...profile, age: val});
                          }}
                          className="w-full bg-[#F8FAFC] border-none rounded-xl px-4 py-2"
                        />
                      </div>
                  <div>
                    <label className="block text-[#94A3B8] mb-1 italic">{t.maritalStatus}</label>
                    <select 
                      value={profile.maritalStatus}
                      onChange={(e) => setProfile({...profile, maritalStatus: e.target.value})}
                      className="w-full bg-[#F8FAFC] border-none rounded-xl px-4 py-2"
                    >
                      <option value="Single">{t.single}</option>
                      <option value="Married">{t.married}</option>
                      <option value="Widow">{t.widow}</option>
                      <option value="Divorced">{t.divorced}</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[#94A3B8] mb-1 italic">{t.gender}</label>
                    <select 
                      value={profile.gender}
                      onChange={(e) => setProfile({...profile, gender: e.target.value})}
                      className="w-full bg-[#F8FAFC] border-none rounded-xl px-4 py-2"
                    >
                      <option>Male</option>
                      <option>Female</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[#94A3B8] mb-1 italic">{t.city}</label>
                    <input 
                      type="text" 
                      value={profile.city}
                      placeholder="e.g. Mumbai"
                      onChange={(e) => setProfile({...profile, city: e.target.value})}
                      className="w-full bg-[#F8FAFC] border-none rounded-xl px-4 py-2"
                    />
                  </div>
                  <div>
                    <label className="block text-[#94A3B8] mb-1 italic">{t.ped}</label>
                    <select 
                      value={profile.preExisting[0]}
                      onChange={(e) => setProfile({...profile, preExisting: [e.target.value]})}
                      className="w-full bg-[#F8FAFC] border-none rounded-xl px-4 py-2"
                    >
                      <option>None</option>
                      <option>Diabetes</option>
                      <option>Hypertension</option>
                      <option>Asthma</option>
                      <option>Thyroid</option>
                      <option>Chronic Pain</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[#94A3B8] mb-1 italic">{t.medication}</label>
                    <select 
                      value={profile.medication}
                      onChange={(e) => setProfile({...profile, medication: e.target.value})}
                      className="w-full bg-[#F8FAFC] border-none rounded-xl px-4 py-2"
                    >
                      <option>None</option>
                      <option>Daily Vitamins</option>
                      <option>Blood Pressure Meds</option>
                      <option>Insulin</option>
                      <option>Thyroid Meds</option>
                      <option>Others</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[#94A3B8] mb-1 italic">{t.smoking}</label>
                    <select 
                      value={profile.smoking}
                      onChange={(e) => setProfile({...profile, smoking: e.target.value})}
                      className="w-full bg-[#F8FAFC] border-none rounded-xl px-4 py-2"
                    >
                      <option>Non-Smoker</option>
                      <option>Smoker</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[#94A3B8] mb-1 italic">{t.drinking}</label>
                    <select 
                      value={profile.drinking}
                      onChange={(e) => setProfile({...profile, drinking: e.target.value})}
                      className="w-full bg-[#F8FAFC] border-none rounded-xl px-4 py-2"
                    >
                      <option>Non-Drinker</option>
                      <option>Occasional Drinker</option>
                      <option>Regular Drinker</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[#94A3B8] mb-1 italic">{t.lifestyle}</label>
                    <select 
                      value={profile.lifestyle}
                      onChange={(e) => setProfile({...profile, lifestyle: e.target.value})}
                      className="w-full bg-[#F8FAFC] border-none rounded-xl px-4 py-2"
                    >
                      <option>None / Sedentary</option>
                      <option>Walking</option>
                      <option>Running</option>
                      <option>Cycling</option>
                      <option>Gym / Heavy</option>
                    </select>
                  </div>
                  <div className="md:col-span-3">
                    <label className="block text-[#94A3B8] mb-1 italic">{t.surgery}</label>
                    <input 
                      type="text" 
                      value={profile.surgeryHistory}
                      placeholder="e.g. Knee Surgery in 2021"
                      onChange={(e) => setProfile({...profile, surgeryHistory: e.target.value})}
                      className="w-full bg-[#F8FAFC] border-none rounded-xl px-4 py-2"
                    />
                  </div>
                </div>
                <button 
                  onClick={handleRecommend}
                  disabled={loading}
                  className="w-full bg-blue-600 text-white rounded-2xl py-4 font-bold hover:bg-blue-700 transition-all flex items-center justify-center gap-2"
                >
                  {loading ? "..." : t.generate}
                </button>
              </div>

              {recommendations.length > 0 && (
                <div className="space-y-12 pb-24">
                  <div className="flex items-center gap-4 mb-12">
                    <div className="w-12 h-12 bg-yellow-400 rounded-2xl flex items-center justify-center shadow-lg shadow-yellow-200 animate-pulse">
                      <Zap className="w-6 h-6 text-white fill-current" />
                    </div>
                    <div>
                      <h3 className="font-black text-3xl tracking-tight text-slate-900">{t.topMatches}</h3>
                      <p className="text-slate-500 font-medium">Curated by our Expert Analytics for your specific profile</p>
                    </div>
                  </div>
                  
                  {recommendations.map((rec, i) => {
                    const p = (translatedPolicies.length > 0 ? translatedPolicies : policies).find(pol => String(pol.id) === String(rec.policyId));
                    if (!p) return null;
                    return (
                      <motion.div 
                        key={i} 
                        initial={{ opacity: 0, y: 30 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.15 }}
                        className="group bg-white rounded-[40px] border border-slate-100 shadow-[0_32px_64px_-16px_rgba(0,0,0,0.05)] hover:shadow-[0_48px_96px_-24px_rgba(0,102,255,0.12)] hover:border-blue-100 transition-all duration-500 overflow-hidden"
                      >
                        <div className="flex flex-col lg:flex-row">
                          {/* Insight Sidebar */}
                          <div className="lg:w-80 bg-slate-50/50 p-8 border-b lg:border-b-0 lg:border-r border-slate-100 flex flex-col justify-between">
                            <div>
                               <div className="inline-flex items-center gap-2 px-3 py-1 bg-white border border-slate-200 rounded-full text-[10px] font-black text-slate-500 uppercase tracking-widest mb-6 shadow-sm">
                                <Shield className="w-3 h-3 text-blue-500" /> Insurer Trust
                              </div>
                              <p className="text-sm font-bold text-slate-900 leading-relaxed mb-4">
                                {rec.insurerTrustVerdict}
                              </p>
                              <div className="h-1.5 w-full bg-slate-200 rounded-full overflow-hidden mb-8">
                                <motion.div 
                                  initial={{ width: 0 }} 
                                  animate={{ width: "95%" }} 
                                  className="h-full bg-blue-500" 
                                />
                              </div>
                            </div>

                            <div className="space-y-4">
                              <div className="p-4 bg-white rounded-2xl border border-slate-100 shadow-sm text-center">
                                <p className="text-[10px] font-black text-slate-400 uppercase mb-1">Estimated Annual Premium</p>
                                <p className="text-xl font-black text-emerald-600">₹{p.premiumRange}</p>
                              </div>
                              <button 
                                onClick={() => { setShowCalculatorId(p.id); setShowStrategicComparison(true); }}
                                className="w-full bg-blue-600 text-white rounded-2xl py-4 text-sm font-black hover:bg-blue-700 transition-all shadow-lg shadow-blue-200 active:scale-95 flex items-center justify-center gap-2"
                              >
                                <Zap className="w-4 h-4 fill-current" /> Calc. Returns
                              </button>
                              <button 
                                onClick={() => { setActivePolicyId(p.id); setView("analyze"); }}
                                className="w-full bg-slate-100 text-slate-600 rounded-2xl py-4 text-sm font-black hover:bg-slate-200 transition-all active:scale-95"
                              >
                                AI Assistant
                              </button>
                            </div>
                          </div>

                          {/* Main Content */}
                          <div className="flex-1 p-8 lg:p-12">
                            <div className="flex flex-wrap items-center justify-between gap-4 mb-8">
                              <div>
                                <button 
                                  onClick={() => handleCompanyClick(p.company)}
                                  className="text-xs font-black text-blue-600 uppercase tracking-[0.2em] mb-2 hover:underline flex items-center gap-1"
                                >
                                  {p.company} <ExternalLink className="w-3 h-3" />
                                </button>
                                <h2 className="text-3xl lg:text-4xl font-black tracking-tighter text-slate-900">{p.name}</h2>
                              </div>
                              <div className="flex -space-x-2">
                                {[1, 2, 3].map(n => (
                                  <div key={n} className="w-10 h-10 rounded-full border-2 border-white bg-slate-100 flex items-center justify-center overflow-hidden">
                                    <div className="w-full h-full bg-gradient-to-br from-blue-100 to-indigo-100" />
                                  </div>
                                ))}
                                <div className="w-10 h-10 rounded-full border-2 border-white bg-blue-600 flex items-center justify-center text-[10px] font-bold text-white">
                                  +2k
                                </div>
                              </div>
                            </div>

                            <div className="grid md:grid-cols-2 gap-8">
                              <div className="space-y-6">
                                <div>
                                  <h5 className="flex items-center gap-2 text-xs font-black text-slate-400 uppercase tracking-widest mb-3">
                                    <Star className="w-3 h-3 text-yellow-500 fill-current" /> AI Key Insight
                                  </h5>
                                  <p className="text-slate-600 leading-relaxed font-medium">
                                    {rec.whyRecommended}
                                  </p>
                                </div>
                                <div>
                                  <h5 className="flex items-center gap-2 text-xs font-black text-slate-400 uppercase tracking-widest mb-3">
                                    <TrendingUp className="w-3 h-3 text-emerald-500" /> Financial Value
                                  </h5>
                                  <p className="text-slate-600 leading-relaxed font-medium">
                                    {rec.costHighlight}
                                  </p>
                                </div>
                              </div>

                              <div className="space-y-6">
                                <div className="p-6 bg-slate-50 rounded-3xl border border-slate-100">
                                  <h5 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                                    <Zap className="w-3 h-3 text-blue-500" /> Strategic Edge
                                  </h5>
                                  <p className="text-sm font-bold text-slate-800 leading-relaxed italic">
                                    "{rec.comparisonReason}"
                                  </p>
                                </div>

                                {rec.recommendedRiders && rec.recommendedRiders.length > 0 && (
                                  <div className="flex flex-wrap gap-2">
                                    {rec.recommendedRiders.map((rider, idx) => (
                                      <span key={idx} className="px-3 py-1 bg-blue-50 text-blue-600 text-[10px] font-black uppercase rounded-full border border-blue-100">
                                        + {rider}
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              )}
            </motion.div>
          )}

          {view === "policy-analysis" && (
            <motion.div
              key="policy-analysis"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              className="max-w-4xl mx-auto"
            >
              <div className="text-center mb-12">
                <h1 className="text-4xl font-black tracking-tight mb-4">{t.knowYourPolicy}</h1>
                <p className="text-[#64748B] text-lg font-medium">{t.knowYourPolicyDesc}</p>
              </div>

              {!isAnalyzing && (!analysisResult || uploadError) ? (
                <div className="space-y-12">
                  <div className="group relative">
                    <input 
                      type="file" 
                      accept=".pdf"
                      onChange={handleFileUpload}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                    />
                    <div className="border-2 border-dashed border-[#E2E8F0] rounded-[40px] p-16 text-center group-hover:border-blue-400 group-hover:bg-blue-50/30 transition-all">
                      <div className="w-20 h-20 bg-blue-100 rounded-3xl flex items-center justify-center mx-auto mb-6 group-hover:scale-110 transition-transform">
                        <Plus className="w-10 h-10 text-blue-600" />
                      </div>
                      <p className="text-xl font-bold text-[#2D2D2D] mb-2">{t.uploadPrompt}</p>
                      <p className="text-sm text-[#94A3B8]">Supports PDF files up to 20MB</p>
                      {uploadError && (
                        <div className="mt-4 p-4 bg-red-50 border border-red-100 rounded-2xl text-red-600 text-sm font-medium">
                          {uploadError}
                        </div>
                      )}
                    </div>
                  </div>

                  {userPolicies.length > 0 && (
                    <div className="space-y-6">
                      <h3 className="text-xl font-bold flex items-center gap-3">
                        <Shield className="w-6 h-6 text-blue-600" /> {t.previousAnalyses}
                      </h3>
                      <div className="grid md:grid-cols-2 gap-4">
                        {userPolicies.map((p, pIdx) => (
                          <div 
                            key={`${p.id}-${pIdx}`}
                            onClick={() => setAnalysisResult(p.analysis_result)}
                            className="p-6 rounded-[32px] bg-white border border-[#F1F1F1] hover:border-blue-600 cursor-pointer shadow-sm transition-all"
                          >
                            <div className="flex justify-between items-start mb-4">
                              <h4 className="font-bold text-lg">{p.policy_name}</h4>
                              <span className="text-[10px] bg-gray-100 px-2 py-1 rounded-full font-bold text-gray-500">
                                {p.created_at ? new Date(p.created_at).toLocaleDateString() : 'N/A'}
                              </span>
                            </div>
                            <p className="text-xs text-gray-500 line-clamp-2">{p.analysis_result?.summary || 'No summary available'}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : isAnalyzing ? (
                    <div className="text-center py-20">
                      <div className="relative w-48 h-48 mx-auto mb-12">
                        <motion.div 
                          animate={{ rotate: 360, scale: [1, 1.05, 1] }}
                          transition={{ rotate: { duration: 8, repeat: Infinity, ease: "linear" }, scale: { duration: 2, repeat: Infinity } }}
                          className="absolute inset-0 border-4 border-dashed border-blue-600 rounded-full opacity-20"
                        />
                        <motion.div 
                          animate={{ rotate: -360 }}
                          transition={{ duration: 12, repeat: Infinity, ease: "linear" }}
                          className="absolute inset-4 border-2 border-dotted border-blue-400 rounded-full opacity-40"
                        />
                        <motion.div 
                          animate={{ scale: [1, 1.1, 1] }}
                          transition={{ duration: 2, repeat: Infinity }}
                          className="absolute inset-8 bg-gradient-to-br from-blue-50 to-blue-100 rounded-full flex items-center justify-center shadow-inner"
                        >
                          <Activity className="w-12 h-12 text-blue-600" />
                        </motion.div>
                        
                        {/* Scanning beam effect */}
                        <motion.div 
                          animate={{ top: ["10%", "90%", "10%"] }}
                          transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
                          className="absolute left-4 right-4 h-0.5 bg-blue-500/50 blur-[2px] z-10"
                        />
                      </div>
                      <h2 className="text-2xl font-bold mb-4">{t.processing}</h2>
                      <div className="max-w-xs mx-auto space-y-4">
                        <div className="flex justify-center gap-1">
                          {[0, 1, 2].map((i) => (
                            <motion.div
                              key={i}
                              animate={{ opacity: [0.3, 1, 0.3], y: [0, -4, 0] }}
                              transition={{ duration: 1, repeat: Infinity, delay: i * 0.2 }}
                              className="w-2 h-2 bg-blue-600 rounded-full"
                            />
                          ))}
                        </div>
                        <p className="text-sm text-gray-400 italic">"Our AI is reading through the fine print to find hidden clauses..."</p>
                      </div>
                    </div>
                  ) : (
                <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                    <div className="flex justify-between items-center bg-zinc-900 text-white p-8 rounded-[40px] shadow-2xl relative overflow-hidden group">
                      <div className="absolute top-0 right-0 p-4 opacity-10">
                        <Zap className="w-32 h-32 text-white" />
                      </div>
                      <div className="flex-1 relative z-10">
                        <div className="flex items-center gap-4 mb-3">
                           <div className="px-3 py-1 bg-white/20 rounded-full text-[10px] font-black tracking-widest uppercase border border-white/30">
                            Policy Analytics Engine
                           </div>
                           <h2 className="text-3xl font-black">{analysisResult.policyName}</h2>
                           <div className="flex gap-2">
                              {/* Video removed */}
                           </div>
                        </div>
                        <p className="text-gray-300 text-lg font-medium leading-relaxed max-w-3xl">
                          {analysisResult.summary}
                        </p>
                        
                        <div className="mt-6 flex items-center gap-4">
                          <button 
                            onClick={() => {
                              const utterance = new SpeechSynthesisUtterance(analysisResult.summary);
                              utterance.lang = language === 'hi' ? 'hi-IN' : 'en-IN';
                              window.speechSynthesis.speak(utterance);
                            }}
                            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 rounded-2xl text-xs font-bold hover:bg-indigo-700 transition-all border border-indigo-500/50 shadow-lg shadow-indigo-500/20"
                          >
                            <Activity className="w-4 h-4" /> Listen to Audio Summary
                          </button>
                        </div>
                      </div>
                      <div className="flex gap-2 ml-4 relative z-10">
                        <button 
                          onClick={() => setAnalysisResult(null)}
                          className="px-6 py-4 bg-white/10 rounded-3xl hover:bg-white/20 transition-all font-bold whitespace-nowrap border border-white/20"
                        >
                          New Analysis
                        </button>
                      </div>
                    </div>

                    <div className="flex gap-4 p-2 bg-gray-100/50 rounded-[24px] w-fit mb-8">
                      <button 
                        onClick={() => setActiveTab("summary")}
                        className={cn("px-6 py-2.5 rounded-[18px] text-sm font-black transition-all", activeTab === "summary" ? "bg-white shadow-sm text-blue-600" : "text-gray-500")}
                      >
                         Summary
                      </button>
                      <button 
                        onClick={() => setActiveTab("compliance")}
                        className={cn("px-6 py-2.5 rounded-[18px] text-sm font-black transition-all", activeTab === "compliance" ? "bg-white shadow-sm text-blue-600" : "text-gray-500")}
                      >
                         IRDAI Compliance
                      </button>
                    </div>

                  {activeTab === "summary" ? (
                    <div className="grid md:grid-cols-3 gap-6">
                      <div className="bg-white p-8 rounded-[40px] border border-gray-100 shadow-sm space-y-6">
                      <h4 className="text-xs font-black uppercase tracking-widest text-[#64748B] flex items-center gap-2">
                        <CheckCircle className="w-4 h-4 text-emerald-500" /> {t.keyTerms}
                      </h4>
                      <ul className="space-y-4">
                        {analysisResult.keyTerms?.map((term: any, i: number) => (
                          <li key={i} className="flex gap-3 text-sm font-medium leading-relaxed">
                            <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-emerald-400 mt-2" />
                            {typeof term === 'string' ? term : (
                              <div>
                                <span className="font-bold">{term.term || term.name || JSON.stringify(term)}</span>
                                {term.definition && <p className="text-gray-500 font-normal mt-1">{term.definition}</p>}
                              </div>
                            )}
                          </li>
                        ))}
                        {(!analysisResult.keyTerms || analysisResult.keyTerms.length === 0) && <li className="text-gray-400 italic text-sm">No key terms identified.</li>}
                      </ul>
                    </div>

                    <div className="bg-white p-8 rounded-[40px] border border-gray-100 shadow-sm space-y-6">
                      <h4 className="text-xs font-black uppercase tracking-widest text-[#64748B] flex items-center gap-2">
                        <X className="w-4 h-4 text-red-500" /> {t.policyExclusions}
                      </h4>
                      <ul className="space-y-4">
                        {analysisResult.exclusions?.map((item: any, i: number) => (
                          <li key={i} className="flex gap-3 text-sm font-medium leading-relaxed">
                            <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-red-400 mt-2" />
                            {typeof item === 'string' ? item : (
                              <div>
                                <span className="font-bold">{item.exclusion || item.item || item.term || JSON.stringify(item)}</span>
                                {item.description && <p className="text-gray-500 font-normal mt-1">{item.description}</p>}
                              </div>
                            )}
                          </li>
                        ))}
                        {(!analysisResult.exclusions || analysisResult.exclusions.length === 0) && <li className="text-gray-400 italic text-sm">No exclusions identified.</li>}
                      </ul>
                    </div>

                    <div className="bg-white p-8 rounded-[40px] border border-gray-100 shadow-sm space-y-6">
                      <h4 className="text-xs font-black uppercase tracking-widest text-[#64748B] flex items-center gap-2">
                        <Info className="w-4 h-4 text-amber-500" /> {t.limitations}
                      </h4>
                      <ul className="space-y-4">
                        {analysisResult.limitations?.map((item: any, i: number) => (
                          <li key={i} className="flex gap-3 text-sm font-medium leading-relaxed">
                            <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-amber-400 mt-2" />
                            {typeof item === 'string' ? item : (
                              <div>
                                <span className="font-bold">{item.limitation || item.item || item.term || JSON.stringify(item)}</span>
                                {item.description && <p className="text-gray-500 font-normal mt-1">{item.description}</p>}
                              </div>
                            )}
                          </li>
                        ))}
                        {(!analysisResult.limitations || analysisResult.limitations.length === 0) && <li className="text-gray-400 italic text-sm">No limitations identified.</li>}
                      </ul>
                    </div>
                  </div>
                ) : (
                    <div className="space-y-6">
                       <div className={cn(
                         "p-8 rounded-[40px] border flex items-center justify-between",
                         analysisResult.compliance?.status === 'High' ? "bg-emerald-50 border-emerald-100" : analysisResult.compliance?.status === 'Low' ? "bg-red-50 border-red-100" : "bg-blue-50 border-blue-100"
                       )}>
                          <div>
                            <h3 className="text-2xl font-black mb-1">Audit Score: {analysisResult.compliance?.status || 'N/A'}</h3>
                            <p className="text-sm font-medium opacity-70">Based on IRDAI 2024 Master Circulars</p>
                          </div>
                          <Shield className={cn("w-12 h-12", analysisResult.compliance?.status === 'High' ? "text-emerald-600" : analysisResult.compliance?.status === 'Low' ? "text-red-600" : "text-blue-600")} />
                       </div>

                       <div className="grid md:grid-cols-2 gap-6">
                         <div className="bg-white p-8 rounded-[40px] border border-gray-100 shadow-sm">
                            <h4 className="text-xs font-black uppercase tracking-widest text-gray-500 mb-6 font-bold flex items-center gap-2 underline decoration-blue-500 decoration-2 underline-offset-4">
                              Findings & Deviations
                            </h4>
                            <ul className="space-y-4">
                              {analysisResult.compliance?.findings?.map((f: string, i: number) => (
                                <li key={i} className="flex gap-4">
                                  <div className="shrink-0 w-6 h-6 rounded-lg bg-blue-50 flex items-center justify-center text-[10px] font-bold text-blue-600">{i+1}</div>
                                  <p className="text-sm font-medium leading-relaxed">{f}</p>
                                </li>
                              ))}
                            </ul>
                         </div>
                         <div className="bg-white p-8 rounded-[40px] border border-gray-100 shadow-sm">
                            <h4 className="text-xs font-black uppercase tracking-widest text-gray-500 mb-6 font-bold flex items-center gap-2 underline decoration-amber-500 decoration-2 underline-offset-4">
                              Gray Areas / Ambiguities
                            </h4>
                            <ul className="space-y-4">
                              {analysisResult.compliance?.ambiguities?.map((a: string, i: number) => (
                                <li key={i} className="flex gap-4">
                                  <div className="shrink-0 w-6 h-6 rounded-lg bg-amber-50 flex items-center justify-center text-[10px] font-bold text-amber-600">?</div>
                                  <p className="text-sm font-medium leading-relaxed">{a}</p>
                                </li>
                              ))}
                            </ul>
                            <div className="mt-8 p-4 bg-amber-50 rounded-2xl flex items-center gap-3">
                              <Zap className="w-5 h-5 text-amber-600" />
                              <p className="text-[10px] font-black text-amber-800 uppercase tracking-tighter">Pro-Tip: These gray areas are often used to reject claims. Clarify with insurer.</p>
                            </div>
                         </div>
                       </div>
                    </div>
                  )}
                </div>
              )}
            </motion.div>
          )}

          {view === "claims" && (
            <motion.div
              key="claims"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              className="max-w-4xl mx-auto"
            >
              <div className="text-center mb-12">
                <h1 className="text-4xl font-black tracking-tight mb-4">{t.claims}</h1>
                <p className="text-[#64748B] text-lg font-medium">{t.claimDesc}</p>
              </div>

              <div className="grid md:grid-cols-[1fr_2fr] gap-8">
                <div className="space-y-6">
                  <div className="bg-white p-8 rounded-[40px] border border-gray-100 shadow-sm">
                     <div className="flex items-center gap-3 mb-6">
                       <div className="bg-red-100 p-2 rounded-xl"><AlertCircle className="w-5 h-5 text-red-600"/></div>
                       <h4 className="font-bold">{t.rejectionReason}</h4>
                     </div>
                     <textarea 
                       value={claimScenario}
                       onChange={(e) => setClaimScenario(e.target.value)}
                       placeholder={t.rejectionPlaceholder}
                       className="w-full bg-[#F8FAFC] border-none rounded-2xl p-6 text-sm min-h-[200px] resize-none focus:ring-2 focus:ring-red-500/10 mb-4"
                     />
                     <button 
                       onClick={handleClaimAnalysis}
                       disabled={loading || !claimScenario}
                       className="w-full bg-black text-white rounded-2xl py-4 font-bold hover:bg-[#222222] transition-all disabled:opacity-30 flex items-center justify-center gap-2"
                     >
                       {loading ? <Activity className="w-4 h-4 animate-spin"/> : t.checkCompliance}
                     </button>
                  </div>
                </div>

                <div className="space-y-6">
                   {claimAnalysis && !claimAnalysis.error ? (
                     <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
                        <div className={cn(
                          "p-8 rounded-[40px] border flex items-center justify-between",
                          claimAnalysis.complianceStatus === 'Compliant' ? "bg-emerald-50 border-emerald-100" : claimAnalysis.complianceStatus === 'Non-Compliant' ? "bg-red-50 border-red-100" : "bg-blue-50 border-blue-100"
                        )}>
                           <div>
                             <h3 className="text-2xl font-black mb-1">{claimAnalysis.complianceStatus} Rejection</h3>
                             <p className="text-sm font-medium opacity-70">{claimAnalysis.assessment}</p>
                           </div>
                        </div>

                        <div className="p-8 rounded-[40px] bg-white border border-gray-100 shadow-sm">
                           <h4 className="text-xs font-black uppercase tracking-widest text-gray-500 mb-6 flex items-center gap-2 underline decoration-blue-500 decoration-4 underline-offset-8">
                             Relevant IRDAI Rules
                           </h4>
                           <ul className="space-y-4">
                             {claimAnalysis.rules?.map((rule: string, i: number) => (
                               <li key={i} className="flex gap-4">
                                 <div className="shrink-0 w-6 h-6 rounded-full bg-blue-50 flex items-center justify-center text-[10px] font-bold text-blue-600">§</div>
                                 <p className="text-sm font-medium leading-relaxed">{rule}</p>
                               </li>
                             ))}
                           </ul>
                        </div>

                        <div className="p-8 rounded-[40px] bg-white border border-gray-100 shadow-sm">
                           <h4 className="text-xs font-black uppercase tracking-widest text-gray-500 mb-6 flex items-center gap-2 underline decoration-emerald-500 decoration-4 underline-offset-8">
                             {t.stepsToFight}
                           </h4>
                           <ul className="space-y-4">
                             {claimAnalysis.steps?.map((step: string, i: number) => (
                               <li key={i} className="flex gap-4">
                                 <div className="shrink-0 w-6 h-6 rounded-full bg-emerald-50 flex items-center justify-center text-[10px] font-bold text-emerald-600">{i+1}</div>
                                 <p className="text-sm font-medium leading-relaxed">{step}</p>
                                </li>
                              ))}
                            </ul>
                         </div>

                         <div className="p-8 rounded-[40px] bg-zinc-900 text-white shadow-2xl">
                            <div className="flex items-center gap-3 mb-4">
                              <Shield className="w-6 h-6 text-emerald-400" />
                              <h4 className="font-bold text-emerald-400 text-sm uppercase tracking-widest">{t.caseStudy}</h4>
                            </div>
                            <p className="text-sm text-zinc-300 leading-relaxed italic">"{claimAnalysis.caseStudy}"</p>
                            <div className="mt-8 pt-8 border-t border-zinc-800 flex justify-between items-end">
                               <div>
                                 <p className="text-[10px] text-zinc-500 uppercase font-black mb-1">Official Resource</p>
                                 <p className="font-bold">{t.irdaiComplaint}</p>
                               </div>
                               <a href="https://bimabharosa.irdai.gov.in/" target="_blank" rel="noreferrer" className="px-6 py-2 bg-emerald-500 text-black rounded-xl text-xs font-black hover:bg-emerald-400 transition-all">VISIT PORTAL</a>
                            </div>
                         </div>
                      </motion.div>
                    ) : (
                      <div className="h-full bg-gray-50 rounded-[40px] border-2 border-dashed border-gray-200 flex flex-col items-center justify-center p-12 text-center text-gray-400">
                        <Shield className="w-16 h-16 mb-4 opacity-20" />
                        <p className="max-w-xs font-medium">Enter rejection details to generate your compliance report and next steps.</p>
                      </div>
                    )}
                 </div>
               </div>
             </motion.div>
           )}

          {view === "analyze" && (
            <motion.div
              key="analyze"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="max-w-4xl mx-auto"
            >
              <div className="mb-12">
                <h1 className="text-3xl font-bold mb-4">{t.assistant}</h1>
                <p className="text-[#64748B]">Analyze your specific {insuranceType} insurance scenario.</p>
              </div>

              <div className="grid md:grid-cols-[1fr_2fr] gap-8">
                <div className="space-y-4">
                  <h3 className="text-xs font-bold text-[#94A3B8] uppercase tracking-widest px-2">Select Policy</h3>
                  {translatedPolicies.map(p => (
                    <button
                      key={p.id}
                      onClick={() => setActivePolicyId(p.id)}
                      className={cn(
                        "w-full text-left p-4 rounded-2xl border transition-all text-sm",
                        activePolicyId === p.id 
                          ? "bg-white border-[#0066FF] shadow-lg shadow-blue-500/5 ring-1 ring-blue-500/20" 
                          : "bg-transparent border-transparent hover:bg-[#F1F1F1] text-[#64748B]"
                      )}
                    >
                      <div className="font-bold mb-0.5">{p.name}</div>
                      <div className="text-[10px] uppercase font-semibold text-[#94A3B8]">{p.company}</div>
                    </button>
                  ))}
                </div>

                <div className="space-y-6">
                  <div className="bg-white p-6 rounded-3xl border border-[#F1F1F1] shadow-sm">
                    <div className="flex items-center gap-3 mb-6">
                      <div className="bg-blue-100 p-2 rounded-xl"><Info className="w-5 h-5 text-blue-600"/></div>
                      <h4 className="font-bold">{t.scenario}</h4>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="relative flex-1">
                        <textarea 
                          value={query}
                          onChange={(e) => setQuery(e.target.value)}
                          placeholder={t.placeholder}
                          className="w-full bg-[#F8FAFC] border-none rounded-2xl p-6 text-sm min-h-[150px] resize-none focus:ring-2 focus:ring-blue-500/10"
                        />
                        <button 
                          onClick={startListening}
                          className={cn(
                            "absolute bottom-4 right-4 p-3 rounded-xl transition-all",
                            isListening ? "bg-red-500 text-white animate-pulse" : "bg-gray-100 text-gray-400 hover:bg-gray-200"
                          )}
                        >
                          <Activity className="w-5 h-5" />
                        </button>
                      </div>
                    </div>
                    <button 
                      onClick={handleAnalyze}
                      disabled={loading || !activePolicyId}
                      className="w-full mt-6 bg-black text-white rounded-2xl py-4 font-bold hover:bg-[#222222] transition-all disabled:opacity-30 flex items-center justify-center gap-2"
                    >
                      {loading ? "..." : t.simplify}
                    </button>
                  </div>

                  {analysis && !analysis.error && (
                    <motion.div 
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="space-y-6"
                    >
                      <div className="grid sm:grid-cols-2 gap-4">
                        <div className="p-6 rounded-3xl bg-blue-50 border border-blue-100">
                          <div className="flex items-center justify-between mb-3">
                            <h5 className="text-xs font-bold uppercase tracking-widest text-blue-600">{t.gist}</h5>
                            <div className="flex gap-2">
                               <button onClick={() => speak(analysis.explanation)} className="p-1.5 hover:bg-blue-100 rounded-lg text-blue-600 transition-all">
                                  <Activity className="w-4 h-4" />
                               </button>
                               {/* Video removed */}
                            </div>
                          </div>
                          <p className="text-sm text-blue-900 leading-relaxed font-medium">{analysis.explanation}</p>
                        </div>
                        <div className="p-6 rounded-3xl bg-green-50 border border-green-100">
                          <h5 className="text-xs font-bold uppercase tracking-widest text-green-600 mb-3">{t.verdict}</h5>
                          <p className="text-sm text-green-900 leading-relaxed font-semibold">{analysis.verdict}</p>
                        </div>
                      </div>

                      <div className="p-8 rounded-3xl bg-orange-50 border border-orange-100">
                        <h5 className="text-xs font-bold uppercase tracking-widest text-orange-600 mb-4 flex items-center gap-2">
                          <Activity className="w-4 h-4"/> {t.nuances}
                        </h5>
                        <ul className="space-y-3">
                          {analysis.nuances?.map((point: string, i: number) => (
                            <li key={i} className="flex gap-3 text-sm text-orange-900 leading-relaxed">
                              <span className="shrink-0 mt-1.5 w-1.5 h-1.5 rounded-full bg-orange-400" />
                              <span dangerouslySetInnerHTML={{ __html: point.replace(/\*\*(.*?)\*\*/g, '<strong class="font-bold text-orange-950">$1</strong>') }} />
                            </li>
                          ))}
                        </ul>
                      </div>

                      <div className="p-8 rounded-3xl bg-red-50 border border-red-100">
                        <h5 className="text-xs font-bold uppercase tracking-widest text-red-600 mb-4 flex items-center gap-2">
                          <X className="w-4 h-4"/> {t.policyExclusions}
                        </h5>
                        <ul className="space-y-3">
                          {analysis.exclusions?.map((point: string, i: number) => (
                            <li key={i} className="flex gap-3 text-sm text-red-900 leading-relaxed">
                              <span className="shrink-0 mt-1.5 w-1.5 h-1.5 rounded-full bg-red-400" />
                              <span dangerouslySetInnerHTML={{ __html: point.replace(/\*\*(.*?)\*\*/g, '<strong class="font-bold text-red-950">$1</strong>') }} />
                            </li>
                          ))}
                        </ul>
                      </div>
                    </motion.div>
                  )}
                  {analysis?.error && (
                    <div className="p-6 rounded-2xl bg-red-50 text-red-600 text-sm border border-red-100">
                      {analysis.error}
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          )}

          {showRidersId && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-center justify-center p-6"
              onClick={() => setShowRidersId(null)}
            >
              <motion.div
                initial={{ scale: 0.9, opacity: 0, y: 20 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                className="bg-white rounded-[40px] w-full max-w-lg overflow-hidden shadow-2xl"
                onClick={e => e.stopPropagation()}
              >
                <div className="p-8 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                  <div>
                    <h3 className="text-2xl font-black">{t.selectRiders || "Select Riders"}</h3>
                    <p className="text-xs text-slate-400 font-bold uppercase tracking-widest mt-1">Customize Your Plan</p>
                  </div>
                  <button onClick={() => setShowRidersId(null)} className="p-3 bg-white rounded-2xl shadow-sm border border-slate-100 hover:bg-slate-50 transition-all">
                    <X className="w-5 h-5 text-slate-400" />
                  </button>
                </div>
                <div className="p-8 space-y-4 max-h-[60vh] overflow-y-auto">
                  {(() => {
                    const policy = translatedPolicies.find(p => p.id === showRidersId);
                    if (!policy) return null;
                    const riders: any[] = (policy as any).riders_detailed || [];
                    const selected = selectedRiders[policy.id] || [];
                    
                    return (
                      <div className="space-y-3">
                        {riders.length > 0 ? riders.map((rider, idx) => (
                          <div 
                            key={idx}
                            onClick={() => {
                              const isSelected = selected.find(r => r.name === rider.name);
                              const newSelected = isSelected 
                                ? selected.filter(r => r.name !== rider.name)
                                : [...selected, rider];
                              setSelectedRiders({...selectedRiders, [policy.id]: newSelected});
                            }}
                            className={cn(
                              "p-5 rounded-3xl border-2 transition-all cursor-pointer flex items-center justify-between group",
                              selected.find(r => r.name === rider.name)
                                ? "bg-emerald-50 border-emerald-500"
                                : "bg-white border-slate-100 hover:border-emerald-200"
                            )}
                          >
                            <div className="flex items-center gap-4">
                              <div className={cn(
                                "w-6 h-6 rounded-lg flex items-center justify-center border-2 transition-all",
                                selected.find(r => r.name === rider.name)
                                  ? "bg-emerald-500 border-emerald-500"
                                  : "border-slate-200 group-hover:border-emerald-300"
                              )}>
                                {selected.find(r => r.name === rider.name) && <Check className="w-4 h-4 text-white" />}
                              </div>
                              <div>
                                <p className="font-bold text-slate-900">{rider.name}</p>
                                <p className="text-[10px] text-slate-500 uppercase tracking-widest font-bold mt-0.5">
                                  {rider.type === "fixed" ? `+ ₹${rider.base}` : `+ ${rider.base}% of Base Premium`}
                                </p>
                              </div>
                            </div>
                          </div>
                        )) : (
                          <p className="text-center text-slate-400 py-12">No detailed riders available for this policy.</p>
                        )}
                      </div>
                    );
                  })()}
                </div>
                {(() => {
                  const policy = translatedPolicies.find(p => p.id === showRidersId);
                  if (!policy) return null;
                  return (
                    <div className="p-8 bg-slate-900 text-white">
                      <div className="flex justify-between items-center mb-1">
                        <span className="text-slate-400 text-xs font-bold uppercase tracking-widest">{t.totalPremium || "Total Premium"}</span>
                        <span className="text-2xl font-black italic">₹{Math.round(getPolicyTotalPremium(policy)).toLocaleString('en-IN')}</span>
                      </div>
                      <p className="text-[10px] text-slate-500">Includes base, age load, and selected riders</p>
                    </div>
                  );
                })()}
              </motion.div>
            </motion.div>
          )}

          {showComparisonTableId && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[600] bg-black/60 backdrop-blur-sm flex items-center justify-center p-6"
              onClick={() => setShowComparisonTableId(null)}
            >
              <motion.div
                initial={{ scale: 0.9, opacity: 0, y: 20 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                className="bg-white rounded-[40px] w-full max-w-4xl overflow-hidden shadow-2xl"
                onClick={e => e.stopPropagation()}
              >
                <div className="p-8 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                  <div>
                    <h3 className="text-2xl font-black">{t.comparisonTable || "Policy Comparison Table"}</h3>
                    <p className="text-xs text-slate-400 font-bold uppercase tracking-widest mt-1">Detailed Parameter Analysis</p>
                  </div>
                  <button onClick={() => setShowComparisonTableId(null)} className="p-3 bg-white rounded-2xl shadow-sm border border-slate-100 hover:bg-slate-50 transition-all">
                    <X className="w-5 h-5 text-slate-400" />
                  </button>
                </div>
                <div className="p-8">
                  {(() => {
                    const policy = translatedPolicies.find(p => p.id === showComparisonTableId);
                    if (!policy) return null;
                    const comparison = (policy as any).comparison_data || {};
                    return (
                      <div className="rounded-3xl border border-slate-100 overflow-hidden">
                        <table className="w-full text-left border-collapse">
                          <thead className="bg-slate-50">
                            <tr>
                              <th className="px-6 py-4 text-xs font-black uppercase tracking-widest text-slate-400 border-b border-slate-100">Parameter</th>
                              <th className="px-6 py-4 text-xs font-black uppercase tracking-widest text-slate-900 border-b border-slate-100">Details / Value</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-50">
                            {Object.entries(comparison).map(([key, value]) => (
                              <tr key={key} className="hover:bg-slate-50/50 transition-all">
                                <td className="px-6 py-5 text-sm font-bold text-slate-500">{key}</td>
                                <td className="px-6 py-5 text-sm font-black text-slate-900">{String(value)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    );
                  })()}
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      <footer className="border-t border-[#F1F1F1] py-12 px-6 mt-20">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row justify-between items-center gap-8">
          <div className="flex items-center gap-2 opacity-50 select-none">
            <Shield className="w-5 h-5" />
            <span className="font-bold text-sm tracking-tight italic">KYI</span>
          </div>
          <div className="text-xs text-[#94A3B8]">
            &copy; 2024 KYI. Information is for educational purposes. Consult an advisor before buying.
          </div>
        </div>
      </footer>
    </div>
  );
}
