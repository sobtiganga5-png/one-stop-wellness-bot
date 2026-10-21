
const SPREADSHEET_ID =
  "1lDyik6O8-A4or25wWKdZPYIkzIQP8IcC_iGO_riBh5w";

const SHEET_ID = 1696929845;
const MAX_HEADER_ROWS = 30;

// Respond to requests such as:
// /exec?q=IVERGUARD-12%20-%2012%20MG
function doGet(e) {
  try {
    const query = String(e?.parameter?.q || "").trim();

    if (!query) {
      return jsonResponse({
        success: true,
        query: "",
        count: 0,
        products: [],
        message: "Enter a product name using the q parameter."
      });
    }

    const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);

    let sheet = spreadsheet.getSheetById(SHEET_ID);

    // Fallback: find the catalogue by its column headers.
    if (!sheet || !findHeaderInfo(sheet.getDataRange().getDisplayValues())) {
      sheet = spreadsheet.getSheets().find(candidate =>
        findHeaderInfo(candidate.getDataRange().getDisplayValues())
      );
    }

    if (!sheet) {
      throw new Error("Could not find the product catalogue sheet.");
    }

    const values = sheet.getDataRange().getDisplayValues();
    const headerInfo = findHeaderInfo(values);

    if (!headerInfo) {
      throw new Error("Could not identify the catalogue column headers.");
    }

    const records = [];

    for (let r = headerInfo.rowIndex + 1; r < values.length; r++) {
      const row = values[r];
      const product = cell(row, headerInfo.columns.product);

      if (!product) continue;

      const item = {
        product: product,
        brand: cell(row, headerInfo.columns.brand),
        salt: cell(row, headerInfo.columns.salt),
        packing: cell(row, headerInfo.columns.packing),
        category: cell(row, headerInfo.columns.category),
        priceText: cell(row, headerInfo.columns.price),
        status: cell(row, headerInfo.columns.status),
        _row: r + 1
      };

      const score = matchScore(query, item);

      if (score > 0) {
        records.push({ item, score });
      }
    }

    // Strongest matches first, preserving sheet order for ties.
    records.sort((a, b) =>
      b.score - a.score || a.item._row - b.item._row
    );

    const products = records
      .slice(0, 50)
      .map(record => {
        const item = record.item;
        return {
          product: item.product,
          brand: item.brand,
          salt: item.salt,
          packing: item.packing,
          category: item.category,
          priceText: item.priceText,
          status: item.status
        };
      });

    return jsonResponse({
      success: true,
      query,
      count: products.length,
      products
    });

  } catch (error) {
    console.error("Catalogue feed error:", error);

    return jsonResponse({
      success: false,
      error: String(error.message || error),
      products: []
    });
  }
}

// Find the actual header row rather than assuming row 1.
function findHeaderInfo(values) {
  let best = null;
  const limit = Math.min(values.length, MAX_HEADER_ROWS);

  for (let r = 0; r < limit; r++) {
    const headers = values[r].map(normalizeText);

    const columns = {
      product: headers.findIndex(h =>
        h.includes("product") && h.includes("name")
      ),
      category: headers.findIndex(h => h.includes("category")),
      salt: headers.findIndex(h =>
        h.includes("salt") || h.includes("content")
      ),
      packing: headers.findIndex(h =>
        h.includes("packing") || h.includes("pack size")
      ),
      brand: headers.findIndex(h => h.includes("brand")),
      price: headers.findIndex(h => h.includes("price")),
      status: headers.findIndex(h => h.includes("status"))
    };

    if (columns.product < 0) continue;

    let score = 5;

    if (columns.price >= 0) score += 3;
    if (columns.brand >= 0) score += 2;
    if (columns.category >= 0) score += 2;
    if (columns.salt >= 0) score += 1;
    if (columns.packing >= 0) score += 1;
    if (columns.status >= 0) score += 1;

    if (!best || score > best.score) {
      best = { rowIndex: r, columns, score };
    }
  }

  return best;
}

function cell(row, index) {
  if (index === undefined || index < 0) return "";
  return String(row[index] || "").trim();
}

// Normalizes case, punctuation, hyphens and repeated spaces.
function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[‐‑‒–—−]/g, "-")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function compactText(value) {
  return normalizeText(value).replace(/[^a-z0-9]/g, "");
}

// Exact product-name matches rank above partial matches.
function matchScore(query, item) {
  const q = normalizeText(query);
  const qc = compactText(query);

  const product = normalizeText(item.product);
  const productCompact = compactText(item.product);

  const allFields = normalizeText([
    item.product,
    item.brand,
    item.salt,
    item.packing,
    item.category,
    item.status
  ].join(" "));

  const allCompact = compactText(allFields);

  if (!q || !qc) return 0;

  if (product === q) return 1000;
  if (productCompact === qc) return 950;

  if (product.includes(q)) return 900;
  if (productCompact.includes(qc)) return 850;

  if (allFields.includes(q)) return 800;
  if (allCompact.includes(qc)) return 750;

  // Permit token-based matching when separators differ.
  const tokens = q.split(" ").filter(Boolean);
  const matched = tokens.filter(token => allFields.includes(token));

  if (matched.length === tokens.length) {
    return 600 + tokens.length;
  }

  // Partial search for shorter product queries.
  if (tokens.length > 1 && matched.length > 0) {
    return 100 + matched.length;
  }

  return 0;
}

function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
