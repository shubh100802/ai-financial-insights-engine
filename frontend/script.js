// ========== CONFIGURATION ==========
const STORAGE_KEY = "financialInsightsData";
let categoryChartRef = null;
let monthlyChartRef = null;
const API_BASE_URL = "";

// ========== DATA PROCESSING ==========
const formatCurrency = (value) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(Number(value || 0));

const savePayload = (payload) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
};

const getPayload = () => {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    return null;
  }
};

// ========== ERROR HANDLING ==========
const setStatus = (el, text, tone = "muted") => {
  el.textContent = text;
  el.classList.remove("muted", "status-success", "status-error");
  el.classList.add(tone);
};

const setLoadingState = (isLoading) => {
  const analyzeBtn = document.getElementById("analyzeBtn");
  const demoBtn = document.getElementById("demoBtn");
  const fileInput = document.getElementById("csvFile");

  [analyzeBtn, demoBtn, fileInput].forEach((el) => {
    if (el) {
      el.disabled = isLoading;
    }
  });

  if (analyzeBtn) {
    analyzeBtn.textContent = isLoading ? "Analyzing..." : "Analyze File";
  }
};

// ========== API CALL ==========
const parseApiResponse = async (response) => {
  const contentType = response.headers.get("content-type") || "";
  const text = await response.text();

  if (contentType.includes("application/json")) {
    try {
      return JSON.parse(text);
    } catch (error) {
      throw new Error("Server returned invalid JSON.");
    }
  }

  if (text.trim().startsWith("<!DOCTYPE") || text.trim().startsWith("<html")) {
    throw new Error(
      "Received HTML instead of API JSON. Make sure backend is running on http://localhost:5000."
    );
  }

  throw new Error("Unexpected API response format.");
};

const fetchAndStore = async (url, options = {}) => {
  const response = await fetch(`${API_BASE_URL}${url}`, options);
  const payload = await parseApiResponse(response);
  if (!response.ok) {
    throw new Error(payload.error || "Request failed.");
  }
  savePayload(payload);
};

// ========== FILE UPLOAD HANDLING ==========
const initUploadPage = () => {
  const form = document.getElementById("uploadForm");
  if (!form) {
    return;
  }

  const status = document.getElementById("uploadStatus");
  const demoBtn = document.getElementById("demoBtn");
  const fileInput = document.getElementById("csvFile");
  const dropZone = document.getElementById("dropZone");

  const setSelectedFileStatus = () => {
    const file = fileInput.files?.[0];
    if (!file) {
      return;
    }
    setStatus(status, `Selected: ${file.name}`, "muted");
  };

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const file = fileInput.files?.[0];
    if (!file) {
      setStatus(status, "Please select a CSV file first.", "status-error");
      return;
    }

    const formData = new FormData();
    formData.append("file", file);

    setLoadingState(true);
    setStatus(status, "Uploading and analyzing your file...", "muted");
    try {
      await fetchAndStore("/api/upload", {
        method: "POST",
        body: formData,
      });
      setStatus(status, "Analysis complete. Opening dashboard...", "status-success");
      window.location.href = "./dashboard.html";
    } catch (error) {
      setStatus(status, `Upload failed: ${error.message}`, "status-error");
    } finally {
      setLoadingState(false);
    }
  });

  demoBtn.addEventListener("click", async () => {
    setLoadingState(true);
    setStatus(status, "Loading demo insights...", "muted");
    try {
      await fetchAndStore("/api/demo");
      setStatus(status, "Demo loaded. Opening dashboard...", "status-success");
      window.location.href = "./dashboard.html";
    } catch (error) {
      setStatus(status, `Demo failed: ${error.message}`, "status-error");
    } finally {
      setLoadingState(false);
    }
  });

  fileInput.addEventListener("change", setSelectedFileStatus);

  if (dropZone) {
    ["dragenter", "dragover"].forEach((eventName) => {
      dropZone.addEventListener(eventName, (event) => {
        event.preventDefault();
        dropZone.classList.add("drag-active");
      });
    });

    ["dragleave", "drop"].forEach((eventName) => {
      dropZone.addEventListener(eventName, (event) => {
        event.preventDefault();
        dropZone.classList.remove("drag-active");
      });
    });

    dropZone.addEventListener("drop", (event) => {
      const file = event.dataTransfer?.files?.[0];
      if (!file) {
        return;
      }
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      fileInput.files = dataTransfer.files;
      setSelectedFileStatus();
    });
  }

  const uploadCard = document.querySelector(".upload-card");
  if (uploadCard && window.matchMedia("(pointer: fine)").matches) {
    uploadCard.addEventListener("mousemove", (event) => {
      const rect = uploadCard.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const rotateY = ((x / rect.width) - 0.5) * 8;
      const rotateX = (0.5 - y / rect.height) * 8;
      uploadCard.style.transform = `translateY(-3px) perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg)`;
    });

    uploadCard.addEventListener("mouseleave", () => {
      uploadCard.style.transform = "";
    });
  }
};

// ========== CHART GENERATION ==========
const renderCharts = (analytics) => {
  const categoryCtx = document.getElementById("categoryChart");
  const monthlyCtx = document.getElementById("monthlyTrendChart");
  if (!categoryCtx || !monthlyCtx || !window.Chart) {
    return;
  }

  if (categoryChartRef) {
    categoryChartRef.destroy();
  }
  if (monthlyChartRef) {
    monthlyChartRef.destroy();
  }

  categoryChartRef = new Chart(categoryCtx, {
    type: "doughnut",
    data: {
      labels: (analytics.categoryBreakdown || []).map((item) => item.category),
      datasets: [
        {
          data: (analytics.categoryBreakdown || []).map((item) => item.total),
          backgroundColor: ["#f2d6ff", "#be7bff", "#9f5be0", "#7933b4", "#4c2f87"],
          borderColor: "rgba(18, 0, 26, 0.85)",
          borderWidth: 2,
          hoverOffset: 8,
        },
      ],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { position: "bottom", labels: { color: "#f4e9ff", padding: 14 } },
      },
    },
  });

  monthlyChartRef = new Chart(monthlyCtx, {
    type: "line",
    data: {
      labels: (analytics.monthlyTrend || []).map((item) => item.month),
      datasets: [
        {
          label: "Monthly Spend",
          data: (analytics.monthlyTrend || []).map((item) => item.total),
          borderColor: "#efd2ff",
          backgroundColor: "rgba(239, 210, 255, 0.2)",
          borderWidth: 3,
          pointBackgroundColor: "#12001a",
          pointBorderColor: "#efd2ff",
          tension: 0.35,
          fill: true,
        },
      ],
    },
    options: {
      responsive: true,
      scales: {
        x: { ticks: { color: "#cdb7d9" }, grid: { color: "rgba(239, 210, 255, 0.16)" } },
        y: {
          ticks: { color: "#cdb7d9", callback: (v) => formatCurrency(v) },
          grid: { color: "rgba(239, 210, 255, 0.16)" },
        },
      },
      plugins: { legend: { display: false } },
    },
  });
};

// ========== TABLE RENDERING ==========
const appendCell = (row, text) => {
  const td = document.createElement("td");
  td.textContent = String(text ?? "");
  row.appendChild(td);
};

const clearChildren = (element) => {
  while (element.firstChild) {
    element.removeChild(element.firstChild);
  }
};

// ========== DASHBOARD RENDERING ==========
const renderDashboard = () => {
  const payload = getPayload();
  if (!payload) {
    window.location.href = "./index.html";
    return;
  }

  const file = payload.file || {};
  const data = payload.data || { transactions: [], meta: {} };
  const analytics = payload.analytics || {
    totalSpending: 0,
    transactionCount: 0,
    categoryBreakdown: [],
    monthlyTrend: [],
  };
  const insights = payload.insights || [];
  const prediction = payload.prediction || {
    nextMonth: "Unknown",
    estimatedSpending: 0,
    explanation: "Not enough data.",
  };

  document.getElementById("fileNameLabel").textContent = `Source file: ${
    file.originalname || "unknown"
  }`;
  document.getElementById("totalSpendingValue").textContent = formatCurrency(
    analytics.totalSpending
  );
  document.getElementById("transactionCountValue").textContent =
    analytics.transactionCount ?? 0;
  document.getElementById("predictionValue").textContent = `${formatCurrency(
    prediction.estimatedSpending
  )} (${prediction.nextMonth || "Unknown"})`;
  document.getElementById("predictionConfidenceValue").textContent =
    (payload.prediction?.confidence || "N/A").toUpperCase();
  document.getElementById("predictionExplanation").textContent =
    prediction.explanation || "No prediction explanation available.";
  document.getElementById("keyInsightText").textContent =
    payload.keyInsight || insights[0] || "No key insight available yet.";

  // ========== INSIGHTS DISPLAY ==========
  const insightsList = document.getElementById("insightsList");
  clearChildren(insightsList);
  if (insights.length === 0) {
    const li = document.createElement("li");
    li.textContent = "No insights generated.";
    insightsList.appendChild(li);
  } else {
    insights.forEach((text) => {
      const li = document.createElement("li");
      li.textContent = String(text);
      insightsList.appendChild(li);
    });
  }

  const tableBody = document.getElementById("transactionsTableBody");
  clearChildren(tableBody);
  (data.transactions || []).slice(0, 15).forEach((tx) => {
    const row = document.createElement("tr");
    appendCell(row, tx.date);
    appendCell(row, tx.description);
    appendCell(row, tx.category);
    appendCell(row, formatCurrency(tx.amount));
    tableBody.appendChild(row);
  });

  renderCharts(analytics);
};

// ========== PAGE INITIALIZATION ==========
const page = document.body.dataset.page;
if (page === "upload") {
  initUploadPage();
}
if (page === "dashboard") {
  renderDashboard();
}
