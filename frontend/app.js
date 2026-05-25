const API_BASE = "http://localhost:8000";

// DOM refs
const btnCopyImproved = document.getElementById("btnCopyImproved");
const btnDownloadImproved = document.getElementById("btnDownloadImproved");
const btnCreateDraft = document.getElementById("btnCreateDraft");
const reviewOutput = document.getElementById("reviewOutput");
const reviewContent = document.getElementById("reviewContent");
const improveOutput = document.getElementById("improveOutput");
const improveContent = document.getElementById("improveContent");
const statusEl = document.getElementById("status");

// TestIT Import refs
const fetchInput = document.getElementById("fetchInput");
const btnFetch = document.getElementById("btnFetch");
const btnReviewFetched = document.getElementById("btnReviewFetched");
const btnImproveFetched = document.getElementById("btnImproveFetched");
const fetchOutput = document.getElementById("fetchOutput");
const fetchResult = document.getElementById("fetchResult");

// Manual input refs
const manualInput = document.getElementById("manualInput");
const btnManualReview = document.getElementById("btnManualReview");
const btnManualImprove = document.getElementById("btnManualImprove");

// App state
let lastReviewResult = null;
let lastTestitReadyJson = null;
let lastEditableState = null;
let currentWorkItem = null;
let fetchedWorkItemId = null;
let _fetchInProgress = false;

// Source captured at improve time — used by Create AI Draft
let draftSourceId = null;
let draftSourceAttributes = null;

// ── Utilities ────────────────────────────────────────────────────────────────

const _progressBar = document.getElementById("progressBar");
let _progressTimer = null;
let _progressVal = 0;

function startProgress() {
  if (_progressTimer) clearInterval(_progressTimer);
  _progressVal = 0;
  _progressBar.style.transition = "none";
  _progressBar.style.width = "0%";
  _progressBar.style.opacity = "1";
  _progressTimer = setInterval(() => {
    _progressVal += (85 - _progressVal) * 0.04;
    _progressBar.style.transition = "width 0.25s linear";
    _progressBar.style.width = _progressVal + "%";
  }, 250);
}

function finishProgress() {
  if (_progressTimer) { clearInterval(_progressTimer); _progressTimer = null; }
  _progressBar.style.transition = "width 0.25s ease";
  _progressBar.style.width = "100%";
  setTimeout(() => {
    _progressBar.style.transition = "opacity 0.4s ease";
    _progressBar.style.opacity = "0";
    setTimeout(() => { _progressBar.style.width = "0%"; }, 400);
  }, 250);
}

const _blockTimers = {};

function startBlockProgress(id) {
  const bar = document.getElementById(id);
  if (!bar) return;
  if (_blockTimers[id]) { clearInterval(_blockTimers[id]); }
  bar.style.transition = "none";
  bar.style.width = "0%";
  bar.style.opacity = "1";
  let val = 0;
  _blockTimers[id] = setInterval(() => {
    val += (85 - val) * 0.04;
    bar.style.transition = "width 0.25s linear";
    bar.style.width = val + "%";
  }, 250);
}

function finishBlockProgress(id) {
  const bar = document.getElementById(id);
  if (!bar) return;
  if (_blockTimers[id]) { clearInterval(_blockTimers[id]); delete _blockTimers[id]; }
  bar.style.transition = "width 0.25s ease";
  bar.style.width = "100%";
  setTimeout(() => {
    bar.style.transition = "opacity 0.4s ease";
    bar.style.opacity = "0";
    setTimeout(() => { bar.style.width = "0%"; }, 400);
  }, 250);
}

function setStatus(msg, type = "") {
  statusEl.textContent = msg;
  statusEl.className = "status " + type;
}

function setLoading(on) {
  btnFetch.disabled = on;
  if (on) {
    [btnManualReview, btnManualImprove].forEach(b => b.disabled = true);
    startProgress();
  } else {
    // Don't re-enable manual buttons if fetch just ran — user must explicitly interact with textarea
    if (!_fetchInProgress) {
      const hasManual = manualInput.value.trim().length > 0;
      btnManualReview.disabled = !hasManual;
      btnManualImprove.disabled = !hasManual;
    }
    finishProgress();
  }
  if (currentWorkItem) [btnReviewFetched, btnImproveFetched].forEach(b => b.disabled = on);
  if (on) setStatus("Processing...", "loading");
}

function esc(str) {
  if (typeof str !== "string") return String(str ?? "");
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function warningsBadge(warnings) {
  return warnings?.length ? ` <span class="warnings-badge">⚠ ${warnings.length}</span>` : "";
}

async function doPost(endpoint, body) {
  const resp = await fetch(`${API_BASE}${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`HTTP ${resp.status}: ${text.slice(0, 300)}`);
  }
  return resp.json();
}

function parseManualInput(raw) {
  try {
    return { work_item: JSON.parse(raw), raw_content: null };
  } catch {
    return { work_item: null, raw_content: raw };
  }
}

// ── Render helpers ────────────────────────────────────────────────────────────

function renderStepList(steps) {
  if (!steps?.length) return "<span class='placeholder-text'>—</span>";
  return `<ol class="step-list">${steps.map((s, i) => `
    <li>
      <span class="step-num">${i + 1}.</span>
      <div>
        <div class="step-action">${esc(s.action)}</div>
        ${s.expected ? `<div class="step-expected">✓ ${esc(s.expected)}</div>` : ""}
        ${s.test_data ? `<div class="step-meta">📋 ${esc(s.test_data)}</div>` : ""}
        ${s.comments ? `<div class="step-meta muted">💬 ${esc(s.comments)}</div>` : ""}
      </div>
    </li>`).join("")}</ol>`;
}

function renderEditableStepList(steps, section) {
  if (!steps?.length) return "<span class='placeholder-text'>—</span>";
  return `<ol class="step-list">${steps.map((s, i) => `
    <li>
      <span class="step-num">${i + 1}.</span>
      <div>
        <div class="step-action ef" data-step-section="${section}" data-step-idx="${i}" data-step-field="action" contenteditable="true" spellcheck="false">${esc(s.action)}</div>
        ${s.expected != null ? `<div class="step-expected"><span class="step-icon">✓</span><span class="ef" data-step-section="${section}" data-step-idx="${i}" data-step-field="expected" contenteditable="true" spellcheck="false">${esc(s.expected)}</span></div>` : ""}
        ${s.test_data ? `<div class="step-meta"><span class="step-icon">📋</span><span class="ef" data-step-section="${section}" data-step-idx="${i}" data-step-field="test_data" contenteditable="true" spellcheck="false">${esc(s.test_data)}</span></div>` : ""}
        ${s.comments ? `<div class="step-meta muted"><span class="step-icon">💬</span><span class="ef" data-step-section="${section}" data-step-idx="${i}" data-step-field="comments" contenteditable="true" spellcheck="false">${esc(s.comments)}</span></div>` : ""}
      </div>
    </li>`).join("")}</ol>`;
}

function renderTags(tags) {
  if (!tags?.length) return "";
  return tags.map(t => `<span class="tag">${esc(t)}</span>`).join(" ");
}

function renderMeta(tc) {
  const parts = [];
  const dur = tc.display_duration || tc.duration;
  if (dur) parts.push(`Duration: ${esc(String(dur))}`);
  if (tc.priority) parts.push(`Priority: ${esc(tc.priority)}`);
  if (tc.status) parts.push(`Status: ${esc(tc.status)}`);
  return parts.length
    ? `<div class="tc-meta-row muted">${parts.join(" · ")}</div>`
    : "";
}

function renderAttributes(tc) {
  const attrs = tc.attributes;
  if (!attrs || !Object.keys(attrs).length) return "";
  return `<div class="section-label">Attributes</div>
    <div class="attr-hidden-note">TestIT attributes preserved (UUID keys/values require TestIT attribute dictionary to read).</div>`;
}

function renderReview(data) {
  let html = `<h2>Review Result${warningsBadge(data.warnings)}</h2>`;
  if (data.summary) html += `<div class="review-summary">${esc(data.summary)}</div>`;

  if (data.issues?.length) {
    html += `<div class="section-label">Issues (${data.issues.length}) <span class="issues-hint">— снимите галку чтобы не исправлять</span></div>`;
    data.issues.forEach((issue, idx) => {
      html += `<div class="issue-card" data-issue-idx="${idx}">
        <div class="issue-header">
          <input type="checkbox" class="issue-check" data-idx="${idx}" checked title="Включить в улучшение">
          <span class="severity-badge severity-${issue.severity}">${issue.severity}</span>
          <span class="issue-title">${esc(issue.title)}</span>
        </div>
        <div class="issue-desc">${esc(issue.description)}</div>
        <div class="issue-rec">${esc(issue.recommendation)}</div>
      </div>`;
    });
  }

  if (data.suggested_test_cases?.length) {
    html += `<div class="section-label">Suggested Test Cases (${data.suggested_test_cases.length})</div>`;
    data.suggested_test_cases.forEach(tc => {
      const stepsHtml = (tc.steps || []).map((s, i) => `
        <li><span class="step-num">${i + 1}.</span>
          <div>
            <div class="step-action">${esc(s.action)}</div>
            ${s.expected ? `<div class="step-expected">✓ ${esc(s.expected)}</div>` : ""}
          </div>
        </li>`).join("");
      html += `<div class="suggested-card">
        <div class="suggested-header">
          <span class="tc-type-badge">${tc.type}</span>
          <span class="tc-priority-badge">${tc.priority}</span>
          <span class="suggested-title">${esc(tc.title)}</span>
        </div>
        <ol class="step-list">${stepsHtml}</ol>
      </div>`;
    });
  }

  reviewContent.innerHTML = html || `<span class="placeholder-text">No review data.</span>`;
}

reviewOutput.addEventListener("change", e => {
  if (e.target.classList.contains("issue-check")) {
    e.target.closest(".issue-card").classList.toggle("excluded", !e.target.checked);
  }
});

function getFilteredReview() {
  if (!lastReviewResult) return null;
  const checkboxes = reviewOutput.querySelectorAll(".issue-check");
  if (!checkboxes.length) return lastReviewResult;
  const selected = new Set([...checkboxes].filter(cb => cb.checked).map(cb => +cb.dataset.idx));
  if (selected.size === checkboxes.length) return lastReviewResult;
  return { ...lastReviewResult, issues: (lastReviewResult.issues || []).filter((_, i) => selected.has(i)) };
}

function renderDiff(diff) {
  if (!diff || !diff.changes) return "";
  const summary = diff.summary || {};
  const changes = diff.changes || [];

  const changedFields = Object.entries(summary)
    .filter(([, v]) => v)
    .map(([k]) => k.replace("_changed", "").replace("_", " "))
    .join(", ");

  if (!changes.length) {
    return `<div class="diff-block"><div class="diff-none">No structural changes detected.</div></div>`;
  }

  const typeIcon = { added: "✚", changed: "⟳", removed: "✖" };
  const typeCls  = { added: "diff-added", changed: "diff-changed", removed: "diff-removed" };

  const rows = changes.map(c => `
    <div class="diff-row">
      <span class="${typeCls[c.type] || ""} diff-type">${typeIcon[c.type] || "·"}</span>
      <span class="diff-field">${esc(c.field)}</span>
      ${c.before ? `<span class="diff-before">${esc(c.before)}</span>` : ""}
      ${c.before && c.after ? `<span class="diff-arrow">→</span>` : ""}
      ${c.after ? `<span class="diff-after">${esc(c.after)}</span>` : ""}
    </div>`).join("");

  return `<div class="diff-block">
    ${changedFields ? `<div class="diff-summary-text">Changed: ${esc(changedFields)}</div>` : ""}
    ${rows}
  </div>`;
}

function renderImproved(data) {
  const tc = data.improved_testcase;

  lastEditableState = JSON.parse(JSON.stringify(tc));
  lastTestitReadyJson = JSON.stringify(tc, null, 2);

  improveOutput.style.display = "";

  const improvement_notes = data.improvement_notes || [];
  const allWarnings = data.warnings || [];
  const validationWarnings = data.validation_warnings || [];
  const tcWithDuration = { ...tc, display_duration: data.display_duration };

  let html = "";

  html += `<div class="improve-section">`;
  html += `<div class="edit-hint">✏ Поля можно редактировать — JSON обновится автоматически</div>`;
  if (tc.title) html += `<div class="tc-title ef" data-edit="title" contenteditable="true" spellcheck="false">${esc(tc.title)}</div>`;
  if (tc.tags?.length) html += `<div class="tc-meta-row">${renderTags(tc.tags)}</div>`;
  html += renderMeta(tcWithDuration);
  if (tc.description) html += `<div class="section-label">Description</div><div class="tc-desc ef" data-edit="description" contenteditable="true" spellcheck="false">${esc(tc.description)}</div>`;
  if (tc.preconditions?.length) html += `<div class="section-label">Preconditions</div>${renderEditableStepList(tc.preconditions, "preconditions")}`;
  if (tc.steps?.length) html += `<div class="section-label">Steps</div>${renderEditableStepList(tc.steps, "steps")}`;
  if (tc.postconditions?.length) html += `<div class="section-label">Postconditions</div>${renderEditableStepList(tc.postconditions, "postconditions")}`;
  html += renderAttributes(tc);
  html += `</div>`;

  if (data.diff) {
    html += `<div class="section-label section-divider">Diff Summary</div>${renderDiff(data.diff)}`;
  }

  if (validationWarnings.length) {
    html += `<div class="section-label section-divider">Validation Warnings</div>`;
    html += validationWarnings.map(w => `<div class="warn-item">⚠ ${esc(w)}</div>`).join("");
  }

  if (improvement_notes.length) {
    html += `<div class="section-label section-divider">Improvement Notes</div>`;
    html += improvement_notes.map(n => `<div class="note-item">💡 ${esc(n)}</div>`).join("");
  }

  if (allWarnings.length) {
    html += `<div class="section-label section-divider">Warnings</div>`;
    html += allWarnings.map(w => `<div class="warn-item">⚠ ${esc(w)}</div>`).join("");
  }

  html += `<div class="section-label section-divider">TestIT JSON</div>
    <pre class="live-json-pre">${esc(lastTestitReadyJson)}</pre>`;

  improveContent.innerHTML = html;
  btnCreateDraft.disabled = false;
  btnCopyImproved.disabled = false;
  btnDownloadImproved.disabled = false;
  improveOutput.scrollIntoView({ behavior: "smooth", block: "start" });
}

function updateLiveJson() {
  if (!lastEditableState) return;
  const tc = JSON.parse(JSON.stringify(lastEditableState));

  const titleEl = improveContent.querySelector('[data-edit="title"]');
  if (titleEl) tc.title = titleEl.textContent.trim();

  const descEl = improveContent.querySelector('[data-edit="description"]');
  if (descEl) tc.description = descEl.textContent.trim();

  ["steps", "preconditions", "postconditions"].forEach(section => {
    improveContent.querySelectorAll(`[data-step-section="${section}"]`).forEach(el => {
      const idx = +el.dataset.stepIdx;
      const field = el.dataset.stepField;
      if (tc[section]?.[idx] !== undefined) {
        const val = el.textContent.trim();
        tc[section][idx][field] = val || null;
      }
    });
  });

  lastTestitReadyJson = JSON.stringify(tc, null, 2);

  const pre = improveContent.querySelector(".live-json-pre");
  if (pre) pre.textContent = lastTestitReadyJson;
}

improveContent.addEventListener("input", e => {
  if (e.target.classList.contains("ef")) updateLiveJson();
});

improveContent.addEventListener("keydown", e => {
  if (e.key === "Enter" && !e.shiftKey && e.target.dataset.stepField) e.preventDefault();
});

// ── TestIT Import ─────────────────────────────────────────────────────────────

function mapFetchError(msg) {
  const m = msg.toLowerCase();
  if (m.includes("401") || m.includes("403") || m.includes("authorization"))
    return "TestIT authorization failed. Check TESTIT_PRIVATE_TOKEN in backend .env.";
  if (m.includes("404") || m.includes("not found"))
    return "Work item not found. Check the test case ID.";
  if (m.includes("503") || m.includes("unavailable") || m.includes("configured"))
    return "TestIT is unavailable or TESTIT_BASE_URL / TESTIT_PRIVATE_TOKEN are not set in backend .env.";
  if (m.includes("502"))
    return "TestIT API returned an unexpected error.";
  if (m.includes("could not extract"))
    return "Invalid input. Paste a numeric test case ID, e.g. 6109.";
  return msg;
}

function renderFetchResult(data) {
  const nc = data.normalized_testcase;
  let html = `<div class="fetch-id-badge">Work Item <code>${esc(data.work_item_id)}</code> loaded</div>`;
  if (nc.title) html += `<div class="tc-title">${esc(nc.title)}</div>`;
  if (nc.tags?.length) html += `<div class="tc-meta-row">${renderTags(nc.tags)}</div>`;
  if (nc.priority || nc.status) {
    const parts = [];
    if (nc.priority) parts.push(`Priority: ${esc(nc.priority)}`);
    if (nc.status)   parts.push(`Status: ${esc(nc.status)}`);
    html += `<div class="tc-meta-row muted">${parts.join(" · ")}</div>`;
  }
  if (nc.description) html += `<div class="section-label">Description</div><div class="tc-desc">${esc(nc.description)}</div>`;
  if (nc.steps?.length) html += `<div class="section-label">Steps (${nc.steps.length})</div>${renderStepList(nc.steps)}`;
  if (data.warnings?.length) {
    html += `<div class="section-label">Warnings</div>`;
    html += data.warnings.map(w => `<div class="warn-item">⚠ ${esc(w)}</div>`).join("");
  }
  fetchResult.innerHTML = html;
}

btnFetch.addEventListener("click", async () => {
  const val = fetchInput.value.trim();
  if (!val) { setStatus("Enter test case ID.", "error"); return; }
  _fetchInProgress = true;
  setLoading(true);
  setStatus("Fetching from TestIT...", "loading");
  fetchResult.innerHTML = `<span class="placeholder-text">Loading…</span>`;
  fetchOutput.style.display = "";
  startBlockProgress("fetchProgress");
  try {
    const data = await doPost("/api/testit/workitem/fetch", { input: val });
    currentWorkItem = data.raw_work_item;
    fetchedWorkItemId = data.work_item_id;
    renderFetchResult(data);
    btnReviewFetched.disabled = false;
    btnImproveFetched.disabled = false;
    setStatus(`Work item ${data.work_item_id} loaded.`, "success");
  } catch (err) {
    const friendly = mapFetchError(err.message);
    fetchResult.innerHTML = `<div class="fetch-error">${esc(friendly)}</div>`;
    currentWorkItem = null;
    btnReviewFetched.disabled = true;
    btnImproveFetched.disabled = true;
    setStatus(friendly, "error");
  } finally {
    setLoading(false);       // _fetchInProgress still true → manual buttons stay disabled
    _fetchInProgress = false;
    finishBlockProgress("fetchProgress");
  }
});

btnReviewFetched.addEventListener("click", async () => {
  if (!currentWorkItem) return;
  reviewContent.innerHTML = `<span class="placeholder-text">Loading...</span>`;
  setLoading(true);
  startBlockProgress("reviewProgress");
  try {
    const data = await doPost("/api/review-testcase", { work_item: currentWorkItem });
    lastReviewResult = data;
    renderReview(data);
    setStatus("Review complete.", "success");
  } catch (err) {
    reviewContent.innerHTML = `<span class="placeholder-text">Error</span>`;
    setStatus("Error: " + err.message, "error");
  } finally { setLoading(false); finishBlockProgress("reviewProgress"); }
});

btnImproveFetched.addEventListener("click", async () => {
  if (!currentWorkItem) return;
  draftSourceId = fetchedWorkItemId;
  draftSourceAttributes = currentWorkItem.attributes || {};
  improveContent.innerHTML = `<span class="placeholder-text">Improving...</span>`;
  improveOutput.style.display = "";
  setLoading(true);
  startBlockProgress("improveProgress");
  try {
    const data = await doPost("/api/improve-testcase", {
      work_item: currentWorkItem,
      review: getFilteredReview(),
    });
    renderImproved(data);
    setStatus("Improvement complete.", "success");
  } catch (err) {
    improveContent.innerHTML = `<span class="placeholder-text">Error</span>`;
    setStatus("Error: " + err.message, "error");
  } finally { setLoading(false); finishBlockProgress("improveProgress"); }
});

// ── Manual input ──────────────────────────────────────────────────────────────

manualInput.addEventListener("input", () => {
  const has = manualInput.value.trim().length > 0;
  btnManualReview.disabled = !has;
  btnManualImprove.disabled = !has;
});

btnManualReview.addEventListener("click", async () => {
  const raw = manualInput.value.trim();
  if (!raw) { setStatus("Paste test case content first.", "error"); return; }
  const body = parseManualInput(raw);
  reviewContent.innerHTML = `<span class="placeholder-text">Loading...</span>`;
  setLoading(true);
  startBlockProgress("reviewProgress");
  try {
    const data = await doPost("/api/review-testcase", body);
    lastReviewResult = data;
    renderReview(data);
    setStatus("Review complete.", "success");
  } catch (err) {
    reviewContent.innerHTML = `<span class="placeholder-text">Error</span>`;
    setStatus("Error: " + err.message, "error");
  } finally { setLoading(false); finishBlockProgress("reviewProgress"); }
});

btnManualImprove.addEventListener("click", async () => {
  const raw = manualInput.value.trim();
  if (!raw) { setStatus("Paste test case content first.", "error"); return; }
  draftSourceId = null;
  draftSourceAttributes = null;
  const body = parseManualInput(raw);
  improveContent.innerHTML = `<span class="placeholder-text">Improving...</span>`;
  improveOutput.style.display = "";
  setLoading(true);
  startBlockProgress("improveProgress");
  try {
    const data = await doPost("/api/improve-testcase", {
      ...body,
      review: getFilteredReview(),
    });
    renderImproved(data);
    setStatus("Improvement complete.", "success");
  } catch (err) {
    improveContent.innerHTML = `<span class="placeholder-text">Error</span>`;
    setStatus("Error: " + err.message, "error");
  } finally { setLoading(false); finishBlockProgress("improveProgress"); }
});

// ── Create AI Draft ───────────────────────────────────────────────────────────

function mapDraftError(msg) {
  const m = msg.toLowerCase();
  if (m.includes("testit_project_id"))
    return "TESTIT_PROJECT_ID is not set in backend .env.";
  if (m.includes("testit_draft_section_id"))
    return "TESTIT_DRAFT_SECTION_ID is not set in backend .env.";
  if (m.includes("401") || m.includes("403") || m.includes("authorization"))
    return "TestIT authorization failed. Check TESTIT_PRIVATE_TOKEN.";
  if (m.includes("503") || m.includes("unavailable") || m.includes("configured"))
    return "TestIT is unavailable or config is missing in backend .env.";
  return msg;
}

function renderDraftResult(data) {
  const existing = improveContent.querySelector(".draft-result");
  if (existing) existing.remove();

  const idLabel = data.global_id ? `#${data.global_id}` : data.work_item_id;
  const urlHtml = data.testit_url
    ? `<a class="draft-link" href="${esc(data.testit_url)}" target="_blank">Open in TestIT →</a>`
    : `<span class="muted">ID: ${esc(data.work_item_id)}</span>`;

  const div = document.createElement("div");
  div.className = "draft-result";
  div.innerHTML = `
    <div class="draft-success">
      ✅ Draft created: <strong>${esc(idLabel)}</strong> — ${esc(data.title)}
      ${urlHtml}
    </div>`;
  improveContent.appendChild(div);
  div.scrollIntoView({ behavior: "smooth", block: "center" });
}

btnCreateDraft.addEventListener("click", async () => {
  if (!lastTestitReadyJson) return;
  btnCreateDraft.disabled = true;
  btnCreateDraft.textContent = "Creating…";
  try {
    const data = await doPost("/api/testit/workitem/create-draft", {
      improved_testcase: JSON.parse(lastTestitReadyJson),
      source_work_item_id: draftSourceId || "unknown",
      source_attributes: draftSourceAttributes || {},
    });
    renderDraftResult(data);
    setStatus(`AI draft created: ${data.global_id || data.work_item_id}`, "success");
  } catch (err) {
    const friendly = mapDraftError(err.message);
    setStatus(friendly, "error");
    btnCreateDraft.disabled = false;
  } finally {
    btnCreateDraft.textContent = "Create AI Draft in TestIT";
  }
});

// ── Copy / Download ───────────────────────────────────────────────────────────

async function copyText(text, btn) {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    const orig = btn.textContent;
    btn.textContent = "Copied!";
    setTimeout(() => { btn.textContent = orig; }, 2000);
  } catch {
    setStatus("Clipboard access denied.", "error");
  }
}

btnCopyImproved.addEventListener("click", () => copyText(lastTestitReadyJson, btnCopyImproved));

btnDownloadImproved.addEventListener("click", () => {
  if (!lastTestitReadyJson) return;
  const blob = new Blob([lastTestitReadyJson], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "improved_testcase.json";
  a.click();
  URL.revokeObjectURL(url);
});
