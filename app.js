"use strict";

/* ============================================================
   STATE
   ============================================================ */
let items = [];          // [{description, hsn, gstRate, qty, unit, rate}]
let customerType = "same-state"; // 'same-state' | 'diff-state' | 'nepal'

/* ============================================================
   NUMBER -> INDIAN WORDS
   ============================================================ */
function numberToIndianWords(num) {
  num = Math.round(num);
  if (num === 0) return "Zero";

  const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
    "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen",
    "Eighteen", "Nineteen"];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

  function twoDigits(n) {
    if (n < 20) return ones[n];
    return tens[Math.floor(n / 10)] + (n % 10 ? " " + ones[n % 10] : "");
  }
  function threeDigits(n) {
    if (n < 100) return twoDigits(n);
    return ones[Math.floor(n / 100)] + " Hundred" + (n % 100 ? " " + twoDigits(n % 100) : "");
  }

  let crore = Math.floor(num / 10000000);
  let lakh = Math.floor((num % 10000000) / 100000);
  let thousand = Math.floor((num % 100000) / 1000);
  let rest = num % 1000;

  let parts = [];
  if (crore) parts.push(threeDigits(crore) + " Crore");
  if (lakh) parts.push(threeDigits(lakh) + " Lakh");
  if (thousand) parts.push(threeDigits(thousand) + " Thousand");
  if (rest) parts.push(threeDigits(rest));

  return parts.join(" ");
}

function amountInWords(total) {
  const rupees = Math.floor(total);
  const paise = Math.round((total - rupees) * 100);
  let words = "Rs. " + numberToIndianWords(rupees) + " Only";
  if (paise > 0) {
    words = "Rs. " + numberToIndianWords(rupees) + " and " + numberToIndianWords(paise) + " Paise Only";
  }
  return words;
}

/* ============================================================
   FORMATTING
   ============================================================ */
function inr(n) {
  return Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function qtyFmt(n) {
  const num = Number(n || 0);
  return num % 1 === 0 ? String(num) : num.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

/* ============================================================
   ITEM ROW UI
   ============================================================ */
const itemsListEl = document.getElementById("itemsList");
const itemRowTemplate = document.getElementById("itemRowTemplate");

// Remembers the most recently entered unit/GST rate so new rows can start pre-filled with them.
let lastUsedUnit = "";
let lastUsedGstRate = "";

function addItemRow(prefill) {
  const node = itemRowTemplate.content.firstElementChild.cloneNode(true);
  itemsListEl.appendChild(node);

  if (prefill) {
    node.querySelector(".it-desc").value = prefill.description || "";
    node.querySelector(".it-hsn").value = prefill.hsn || "";
    node.querySelector(".it-gst").value = prefill.gstRate ?? "";
    node.querySelector(".it-qty").value = prefill.qty ?? "";
    node.querySelector(".it-unit").value = prefill.unit || "";
    node.querySelector(".it-rate").value = prefill.rate ?? "";
  } else {
    // Pre-fill unit/GST from the last row the user touched, so repetitive entry is faster.
    // These are just starting values — still fully editable per row.
    if (lastUsedUnit) node.querySelector(".it-unit").value = lastUsedUnit;
    if (lastUsedGstRate !== "") node.querySelector(".it-gst").value = lastUsedGstRate;
  }

  node.querySelector(".item-remove").addEventListener("click", () => {
    node.remove();
    syncTotalsPreview();
  });

  const unitInput = node.querySelector(".it-unit");
  const gstInput = node.querySelector(".it-gst");
  unitInput.addEventListener("change", () => { lastUsedUnit = unitInput.value.trim(); });
  gstInput.addEventListener("change", () => { lastUsedGstRate = gstInput.value; });

  node.querySelectorAll("input").forEach(inp => {
    inp.addEventListener("input", () => {
      updateRowAmount(node);
      syncTotalsPreview();
    });
  });

  updateRowAmount(node);
  syncTotalsPreview();
}

function updateRowAmount(node) {
  const qty = parseFloat(node.querySelector(".it-qty").value) || 0;
  const rate = parseFloat(node.querySelector(".it-rate").value) || 0;
  node.querySelector(".it-amount").textContent = inr(qty * rate);
}

function readItemsFromForm() {
  const rows = [...itemsListEl.querySelectorAll(".item-row")];
  return rows.map(row => ({
    description: row.querySelector(".it-desc").value.trim(),
    hsn: row.querySelector(".it-hsn").value.trim(),
    gstRate: parseFloat(row.querySelector(".it-gst").value) || 0,
    qty: parseFloat(row.querySelector(".it-qty").value) || 0,
    unit: row.querySelector(".it-unit").value.trim() || "PCS",
    rate: parseFloat(row.querySelector(".it-rate").value) || 0,
  })).filter(it => it.description); // skip fully-empty rows
}

document.getElementById("addItemBtn").addEventListener("click", () => addItemRow());

/* ============================================================
   CUSTOMER TYPE CONTROL
   ============================================================ */
const custTypeControl = document.getElementById("custTypeControl");
const nepalExtraFields = document.getElementById("nepalExtraFields");
const taxHint = document.getElementById("taxHint");

custTypeControl.addEventListener("click", (e) => {
  const btn = e.target.closest(".seg-btn");
  if (!btn) return;
  custTypeControl.querySelectorAll(".seg-btn").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
  customerType = btn.dataset.type;
  nepalExtraFields.hidden = customerType !== "nepal";
  updateTaxHint();
  syncTotalsPreview();
});

function updateTaxHint() {
  const hints = {
    "same-state": "Within Uttar Pradesh → CGST + SGST will be applied (split equally from each item's GST rate). One invoice will be generated.",
    "diff-state": "Inter-state (outside UP) → IGST will be applied at each item's full GST rate. One invoice will be generated.",
    "nepal": "Nepal export → IGST applies. Two invoices will be generated: one with tax, one with 0% tax (for the customer).",
  };
  taxHint.textContent = hints[customerType];
}

/* ============================================================
   TAX CALCULATION
   ============================================================ */
// Returns a breakdown for one invoice "mode": 'full-tax' or 'zero-tax'
// taxBasis: 'cgst-sgst' | 'igst'
function computeInvoice(items, taxBasis, mode) {
  let subTotal = 0;
  let totalQty = 0;
  const lineResults = [];
  // group key -> { hsn, rate, taxable, igst, cgst, sgst }
  const groups = new Map();

  items.forEach(it => {
    const amount = it.qty * it.rate;
    subTotal += amount;
    totalQty += it.qty;

    const effectiveRate = mode === "zero-tax" ? 0 : it.gstRate;
    let igst = 0, cgst = 0, sgst = 0;
    if (taxBasis === "igst") {
      igst = amount * effectiveRate / 100;
    } else {
      cgst = amount * (effectiveRate / 2) / 100;
      sgst = amount * (effectiveRate / 2) / 100;
    }
    const lineTax = igst + cgst + sgst;

    lineResults.push({ ...it, amount, igst, cgst, sgst, lineTax, effectiveRate });

    const key = it.hsn + "|" + effectiveRate;
    if (!groups.has(key)) {
      groups.set(key, { hsn: it.hsn, rate: effectiveRate, taxable: 0, igst: 0, cgst: 0, sgst: 0 });
    }
    const g = groups.get(key);
    g.taxable += amount;
    g.igst += igst;
    g.cgst += cgst;
    g.sgst += sgst;
  });

  const totalTax = lineResults.reduce((s, l) => s + l.lineTax, 0);
  const grandTotal = subTotal + totalTax;

  return {
    lineResults,
    subTotal,
    totalQty,
    groups: [...groups.values()],
    totalTax,
    grandTotal,
    taxBasis,
  };
}

function buildInvoicePlans() {
  const itemsData = readItemsFromForm();
  if (itemsData.length === 0) return { error: "Add at least one item with a description." };

  const plans = [];
  if (customerType === "same-state") {
    plans.push({ label: "Tax Invoice (CGST + SGST)", data: computeInvoice(itemsData, "cgst-sgst", "full-tax"), isExportType: false });
  } else if (customerType === "diff-state") {
    plans.push({ label: "Tax Invoice (IGST)", data: computeInvoice(itemsData, "igst", "full-tax"), isExportType: false });
  } else if (customerType === "nepal") {
    plans.push({ label: "With Tax (IGST)", data: computeInvoice(itemsData, "igst", "full-tax"), isExportType: true });
    plans.push({ label: "Without Tax (0%)", data: computeInvoice(itemsData, "igst", "zero-tax"), isExportType: true });
  }
  return { plans, itemsData };
}

/* ============================================================
   LIVE TOTALS PREVIEW (sidebar, not the invoice itself)
   ============================================================ */
function syncTotalsPreview() {
  const result = buildInvoicePlans();
  const el = document.getElementById("totalsPreview");
  if (result.error || !result.plans.length) {
    el.innerHTML = "";
    return;
  }
  const main = result.plans[0].data;
  el.innerHTML = `<span>Sub Total: <strong>₹${inr(main.subTotal)}</strong></span>
                   <span>Total (incl. tax): <strong>₹${inr(main.grandTotal)}</strong></span>`;
}

/* ============================================================
   RENDER A FULL INVOICE SHEET
   ============================================================ */
const invoiceTemplate = document.getElementById("invoiceTemplate");
const invoiceRendersEl = document.getElementById("invoiceRenders");

function renderInvoice(plan, meta) {
  const node = invoiceTemplate.content.firstElementChild.cloneNode(true);
  const data = plan.data;

  // letterhead extras for export invoices
  if (plan.isExportType) {
    node.querySelector(".supply-line").hidden = false;
  }

  // Bill To
  node.querySelector(".cust-name").textContent = meta.custName || "—";
  let addrParts = [meta.custAddress].filter(Boolean);
  node.querySelector(".cust-address").textContent = addrParts.join(", ");
  if (meta.custPhone) {
    const phoneLine = document.createElement("span");
    phoneLine.textContent = "Ph: " + meta.custPhone;
    node.querySelector(".meta-billto").appendChild(phoneLine);
  }
  if (meta.eximCode) {
    const eximEl = node.querySelector(".cust-exim");
    eximEl.hidden = false;
    eximEl.textContent = "Exim Code: " + meta.eximCode;
  }
  node.querySelector(".cust-destination").textContent = meta.destination || "India";
  node.querySelector(".inv-no").textContent = meta.invoiceNo || "—";
  node.querySelector(".inv-date").textContent = meta.invoiceDateDisplay || "—";

  // Item rows
  const tbody = node.querySelector(".invoice-body");
  data.lineResults.forEach((line, idx) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="cell-num">${idx + 1}</td>
      <td><span class="row-desc-main">${escapeHtml(line.description)}</span>${line.hsn ? `<br><span class="row-desc-sub">HSN ${escapeHtml(line.hsn)}</span>` : ""}</td>
      <td class="cell-num">${escapeHtml(line.hsn || "—")}</td>
      <td class="cell-num">${qtyFmt(line.qty)}</td>
      <td>${escapeHtml(line.unit)}</td>
      <td class="cell-num">${inr(line.rate)}</td>
      <td class="cell-amount">${inr(line.amount)}</td>
    `;
    tbody.appendChild(tr);
  });

  // Totals block
  node.querySelector(".subtotal-row .totals-qty").textContent = qtyFmt(data.totalQty);
  node.querySelector(".subtotal-row .totals-amount").textContent = inr(data.subTotal);

  const taxRowsEl = node.querySelector(".tax-rows");
  if (data.taxBasis === "igst") {
    if (data.totalTax > 0 || true) {
      const rate = data.groups[0] ? data.groups[0].rate : 0;
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>Add IGST ${stripTrailingZero(rate)}%</td><td></td><td class="totals-amount">${inr(data.totalTax)}</td>`;
      taxRowsEl.appendChild(tr);
    }
  } else {
    const totalCgst = data.lineResults.reduce((s, l) => s + l.cgst, 0);
    const totalSgst = data.lineResults.reduce((s, l) => s + l.sgst, 0);
    const avgRate = data.groups[0] ? data.groups[0].rate : 0;
    const trC = document.createElement("tr");
    trC.innerHTML = `<td>Add CGST ${stripTrailingZero(avgRate / 2)}%</td><td></td><td class="totals-amount">${inr(totalCgst)}</td>`;
    const trS = document.createElement("tr");
    trS.innerHTML = `<td>Add SGST ${stripTrailingZero(avgRate / 2)}%</td><td></td><td class="totals-amount">${inr(totalSgst)}</td>`;
    taxRowsEl.appendChild(trC);
    taxRowsEl.appendChild(trS);
  }

  node.querySelector(".grand-total-row .totals-amount").textContent = inr(data.grandTotal);
  node.querySelector(".payment-mode-val").textContent = meta.paymentMode || "100% Credit";

  // Tax summary table (grouped by HSN + rate)
  const taxColsHeader = node.querySelector(".tax-cols");
  taxColsHeader.textContent = data.taxBasis === "igst" ? "IGST %" : "CGST % + SGST %";
  const tsRowsEl = node.querySelector(".tax-summary-rows");
  data.groups.forEach(g => {
    const tr = document.createElement("tr");
    const tax = data.taxBasis === "igst" ? g.igst : (g.cgst + g.sgst);
    const rateLabel = data.taxBasis === "igst" ? `${stripTrailingZero(g.rate)}%` : `${stripTrailingZero(g.rate / 2)}+${stripTrailingZero(g.rate / 2)}%`;
    tr.innerHTML = `<td>${escapeHtml(g.hsn || "—")}</td><td class="ts-num">${inr(g.taxable)}</td><td class="ts-num">${rateLabel}</td><td class="ts-num">${inr(tax)}</td>`;
    tsRowsEl.appendChild(tr);
  });
  node.querySelector(".ts-taxable").textContent = inr(data.subTotal);
  node.querySelector(".ts-tax").textContent = inr(data.totalTax);

  // words + received/balance
  node.querySelector(".amount-words").textContent = amountInWords(data.grandTotal);
  const received = parseFloat(meta.amountReceived) || 0;
  node.querySelector(".received-val").textContent = "₹ " + inr(received);
  node.querySelector(".balance-val").textContent = "₹ " + inr(Math.max(data.grandTotal - received, 0));

  return node;
}

function stripTrailingZero(n) {
  n = Math.round(n * 100) / 100;
  return n % 1 === 0 ? String(n) : String(n);
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

/* ============================================================
   GENERATE BUTTON / TABS
   ============================================================ */
const generateBtn = document.getElementById("generateBtn");
const previewToolbar = document.getElementById("previewToolbar");
const previewEmpty = document.getElementById("previewEmpty");
const previewTabs = document.getElementById("previewTabs");

generateBtn.addEventListener("click", () => {
  const result = buildInvoicePlans();
  if (result.error) {
    alert(result.error);
    return;
  }

  const meta = {
    custName: document.getElementById("custName").value.trim(),
    custPhone: document.getElementById("custPhone").value.trim(),
    custAddress: document.getElementById("custAddress").value.trim(),
    eximCode: customerType === "nepal" ? document.getElementById("eximCode").value.trim() : "",
    destination: customerType === "nepal" ? document.getElementById("destination").value.trim() : "India",
    invoiceNo: document.getElementById("invoiceNo").value.trim(),
    paymentMode: document.getElementById("paymentMode").value.trim(),
    amountReceived: document.getElementById("amountReceived").value,
    invoiceDateDisplay: formatDateDisplay(document.getElementById("invoiceDate").value),
  };

  invoiceRendersEl.innerHTML = "";
  previewTabs.innerHTML = "";

  result.plans.forEach((plan, idx) => {
    const sheet = renderInvoice(plan, meta);
    sheet.dataset.planIndex = idx;
    if (idx === 0) sheet.classList.add("active-preview");
    invoiceRendersEl.appendChild(sheet);

    const tabBtn = document.createElement("button");
    tabBtn.className = "tab-btn" + (idx === 0 ? " active" : "");
    tabBtn.textContent = plan.label;
    tabBtn.addEventListener("click", () => {
      previewTabs.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
      tabBtn.classList.add("active");
      invoiceRendersEl.querySelectorAll(".invoice-sheet").forEach(s => s.classList.remove("active-preview"));
      sheet.classList.add("active-preview");
    });
    previewTabs.appendChild(tabBtn);
  });

  previewToolbar.hidden = false;
  previewEmpty.hidden = true;
});

document.getElementById("printBtn").addEventListener("click", () => {
  window.print();
});

function formatDateDisplay(isoDate) {
  if (!isoDate) {
    const today = new Date();
    isoDate = today.toISOString().slice(0, 10);
  }
  const [y, m, d] = isoDate.split("-");
  return `${d}.${m}.${y}`;
}

/* ============================================================
   INIT
   ============================================================ */
document.getElementById("invoiceDate").value = new Date().toISOString().slice(0, 10);
updateTaxHint();
addItemRow(); // start with one empty row