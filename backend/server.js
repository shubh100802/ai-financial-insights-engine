// ========== SERVER SETUP ==========
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const csv = require("csv-parser");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 5000;

// ========== PATHS AND DIRECTORIES ==========
const FRONTEND_DIR = path.join(__dirname, "..", "frontend");
const UPLOAD_DIR = path.join(__dirname, "uploads");
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// ========== MIDDLEWARE CONFIGURATION ==========
const allowedOrigins = (
  process.env.CORS_ORIGIN ||
  "http://localhost:5000,http://127.0.0.1:5500,http://localhost:5500"
)
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error("Origin not allowed by CORS"));
    },
    methods: ["GET", "POST"],
  })
);
app.use(express.json());
app.use(express.static(FRONTEND_DIR));

// ========== FILE UPLOAD HANDLING ==========
const ALLOWED_MIME_TYPES = new Set(["text/csv"]);

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => {
      const base = path.basename(file.originalname || "upload.csv");
      const safe = base.replace(/[^a-zA-Z0-9._-]/g, "_");
      cb(null, `${Date.now()}-${safe}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase();
    const mime = (file.mimetype || "").toLowerCase();
    if (ext === ".csv" && ALLOWED_MIME_TYPES.has(mime)) {
      cb(null, true);
      return;
    }
    const error = new Error("Only valid CSV files are allowed.");
    error.statusCode = 400;
    cb(error, false);
  },
});

// ========== DATA VALIDATION ==========
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const REQUIRED_HEADERS = ["date", "description", "amount"];

const isValidIsoDate = (value) => {
  if (!DATE_PATTERN.test(value)) {
    return false;
  }
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() + 1 === m &&
    date.getUTCDate() === d
  );
};

const normalizeAmount = (value) => {
  const cleaned = String(value ?? "")
    .replace(/[$,]/g, "")
    .trim();
  return Number(cleaned);
};

// ========== CATEGORIZATION LOGIC ==========
const CATEGORY_RULES = {
  Food: ["coffee", "restaurant", "grocery", "groceries", "food", "swiggy", "zomato"],
  Travel: ["uber", "metro", "fuel", "petrol"],
  Bills: ["electricity", "rent", "subscription", "netflix"],
  Shopping: ["amazon", "flipkart", "shopping"],
};

const categorize = (description) => {
  const text = String(description || "").toLowerCase();
  for (const [category, keywords] of Object.entries(CATEGORY_RULES)) {
    if (keywords.some((k) => text.includes(k))) {
      return category;
    }
  }
  return "Others";
};

const monthKeyFromDate = (dateValue) => dateValue.slice(0, 7);
const round2 = (n) => Number(n.toFixed(2));

// ========== ANALYTICS ENGINE ==========
const computeAnalytics = (transactions) => {
  const totalSpending = round2(
    transactions.reduce((sum, tx) => sum + tx.amount, 0)
  );

  const categoryMap = {};
  const monthMap = {};

  transactions.forEach((tx) => {
    categoryMap[tx.category] = (categoryMap[tx.category] || 0) + tx.amount;
    const month = monthKeyFromDate(tx.date);
    monthMap[month] = (monthMap[month] || 0) + tx.amount;
  });

  const categoryBreakdown = Object.entries(categoryMap)
    .map(([category, total]) => ({ category, total: round2(total) }))
    .sort((a, b) => b.total - a.total);

  const monthlyTrend = Object.entries(monthMap)
    .map(([month, total]) => ({ month, total: round2(total) }))
    .sort((a, b) => a.month.localeCompare(b.month));

  return {
    totalSpending,
    transactionCount: transactions.length,
    categoryBreakdown,
    monthlyTrend,
  };
};

// ========== INSIGHTS GENERATION ==========
const generateInsights = (transactions, analytics) => {
  const insights = [];
  const trends = analytics.monthlyTrend;

  if (trends.length >= 2) {
    const prev = trends[trends.length - 2];
    const curr = trends[trends.length - 1];
    if (prev.total > 0) {
      const changePct = ((curr.total - prev.total) / prev.total) * 100;
      if (changePct >= 15) {
        insights.push(
          `Your spending increased significantly in ${curr.month} compared to ${prev.month}. Consider reviewing major purchases from that month.`
        );
      } else if (changePct <= -15) {
        insights.push(
          `Great control in ${curr.month}: spending dropped noticeably versus ${prev.month}.`
        );
      } else {
        insights.push(
          `Your month-to-month spending between ${prev.month} and ${curr.month} stayed fairly stable.`
        );
      }
    }
  }

  if (analytics.categoryBreakdown.length > 0 && analytics.totalSpending > 0) {
    const top = analytics.categoryBreakdown[0];
    const share = (top.total / analytics.totalSpending) * 100;
    insights.push(
      `${top.category} contributes the largest portion of your expenses (${round2(
        share
      )}%).`
    );
  }

  const weekendTotal = transactions
    .filter((tx) => {
      const [y, m, d] = tx.date.split("-").map(Number);
      const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
      return day === 0 || day === 6;
    })
    .reduce((sum, tx) => sum + tx.amount, 0);

  const weekdayTotal = analytics.totalSpending - weekendTotal;
  if (analytics.totalSpending > 0) {
    const weekendShare = (weekendTotal / analytics.totalSpending) * 100;
    if (weekendShare >= 45) {
      insights.push(
        "A large share of spending happens on weekends. Setting a weekend spending cap could help reduce overspending."
      );
    } else if (weekdayTotal > weekendTotal) {
      insights.push(
        "Most of your spending is on weekdays, which usually points to recurring or essential expenses."
      );
    }
  }

  if (insights.length === 0) {
    insights.push("No major spending patterns detected, but your expenses are stable.");
  }

  return insights.slice(0, 4);
};

// ========== PREDICTION LOGIC ==========
const nextMonthFrom = (month) => {
  const [year, mon] = month.split("-").map(Number);
  const d = new Date(Date.UTC(year, mon - 1, 1));
  d.setUTCMonth(d.getUTCMonth() + 1);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};

const predictNextMonth = (analytics) => {
  const trends = analytics.monthlyTrend;
  if (trends.length === 0) {
    return {
      nextMonth: "Unknown",
      estimatedSpending: 0,
      confidence: "low",
      explanation: "Not enough data to estimate next month.",
    };
  }

  if (trends.length < 2) {
    const onlyTotal = trends[0].total;
    return {
      nextMonth: nextMonthFrom(trends[0].month),
      estimatedSpending: onlyTotal,
      confidence: "low",
      explanation: "Estimate based on limited data (average-based prediction).",
    };
  }

  const totals = trends.map((m) => m.total);
  const average = totals.reduce((a, b) => a + b, 0) / totals.length;
  const latest = totals[totals.length - 1];
  const previous = totals.length > 1 ? totals[totals.length - 2] : latest;
  const trendBoost = latest - previous;
  const estimate = Math.max(0, round2(average * 0.7 + (latest + trendBoost) * 0.3));

  return {
    nextMonth: nextMonthFrom(trends[trends.length - 1].month),
    estimatedSpending: estimate,
    confidence: trends.length >= 4 ? "high" : trends.length >= 2 ? "medium" : "low",
    explanation:
      "This estimate blends your average monthly spend with your most recent trend.",
  };
};

// ========== CSV PARSING ==========
const parseCsvFile = (filePath) =>
  new Promise((resolve, reject) => {
    const transactions = [];
    const invalidRows = [];
    let headersValidated = false;
    let missingHeaders = [];
    let rowNumber = 1;

    fs.createReadStream(filePath)
      .pipe(csv({ mapHeaders: ({ header }) => String(header || "").trim().toLowerCase() }))
      .on("headers", (headers) => {
        missingHeaders = REQUIRED_HEADERS.filter((h) => !headers.includes(h));
        headersValidated = true;
      })
      .on("data", (row) => {
        rowNumber += 1;
        if (!headersValidated || missingHeaders.length > 0) {
          return;
        }

        const date = String(row.date || "").trim();
        const description = String(row.description || "").trim();
        const amount = normalizeAmount(row.amount);

        if (!isValidIsoDate(date) || !description || !Number.isFinite(amount)) {
          invalidRows.push({
            rowNumber,
            row: {
              date,
              description,
              amount: String(row.amount ?? ""),
            },
          });
          return;
        }

        transactions.push({
          date,
          description,
          amount: round2(amount),
          category: categorize(description),
        });
      })
      .on("end", () => {
        if (missingHeaders.length > 0) {
          const err = new Error(
            `Missing required column(s): ${missingHeaders.join(", ")}. Expected headers: date, description, amount`
          );
          err.statusCode = 400;
          reject(err);
          return;
        }
        resolve({
          transactions,
          meta: {
            totalRows: transactions.length + invalidRows.length,
            validRows: transactions.length,
            invalidRows: invalidRows.length,
          },
          invalidRowSamples: invalidRows.slice(0, 5),
        });
      })
      .on("error", (error) => reject(error));
  });

// ========== RESPONSE BUILDING ==========
const buildResponsePayload = (parsed, sourceFileName = "uploaded.csv") => {
  const analytics = computeAnalytics(parsed.transactions);
  const insights = generateInsights(parsed.transactions, analytics);
  const prediction = predictNextMonth(analytics);
  const keyInsight =
    insights[0] ||
    "Your spending data is now processed. Upload more historical data for deeper insights.";

  return {
    message: "File processed successfully",
    file: { originalname: sourceFileName },
    data: parsed,
    analytics,
    insights,
    keyInsight,
    prediction,
  };
};

// ========== API ROUTES ==========
app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

app.get("/api/demo", (req, res) => {
  const demoParsed = {
    transactions: [
      { date: "2026-01-03", description: "Coffee shop", amount: 220, category: "Food" },
      { date: "2026-01-09", description: "Uber trip", amount: 380, category: "Travel" },
      { date: "2026-02-02", description: "Electricity bill", amount: 1800, category: "Bills" },
      { date: "2026-02-12", description: "Amazon order", amount: 1200, category: "Shopping" },
      { date: "2026-03-04", description: "Grocery store", amount: 950, category: "Food" },
    ],
    meta: { totalRows: 5, validRows: 5, invalidRows: 0 },
  };
  res.json(buildResponsePayload(demoParsed, "demo-data.csv"));
});

app.post("/api/upload", upload.single("file"), async (req, res, next) => {
  if (!req.file) {
    return res.status(400).json({ error: "CSV file is required." });
  }

  try {
    const parsed = await parseCsvFile(req.file.path);
    if (parsed.transactions.length === 0) {
      return res.status(400).json({ error: "No valid transactions found in file" });
    }
    const payload = buildResponsePayload(parsed, req.file.originalname);
    return res.json(payload);
  } catch (error) {
    return next(error);
  } finally {
    if (req.file?.path) {
      fsp.unlink(req.file.path).catch(() => {});
    }
  }
});

app.get("/", (req, res) => {
  res.sendFile(path.join(FRONTEND_DIR, "index.html"));
});

// ========== ERROR HANDLING ==========
app.use((err, req, res, next) => {
  const statusCode = err.statusCode || (err.name === "MulterError" ? 400 : 500);
  const safeMessage =
    statusCode >= 500 ? "Internal server error" : err.message || "Request failed.";
  res.status(statusCode).json({ error: safeMessage });
});

// ========== SERVER START ==========
app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
