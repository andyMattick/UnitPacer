/* Unit Pacer — School Setup wizard
 *
 * Builds a school-year calendar for any teacher:
 *   1. School basics (name, first/last day, periods per day)
 *   2. School calendar import (.ics or .csv) + manual add/edit of events
 *   3. Class schedule type (rotating letters, same every day, A/B, weekday-based) + period map
 *   4. The classes you teach
 *
 * The result is a normal "custom calendar pack" used by the planner, so every existing
 * unit-planning feature works unchanged. Loaded after the main planner script; it uses
 * the planner's globals (savedPacks, usePack, teacherSchedule, specialDays, ...).
 */
(function () {
  "use strict";

  const WEEKDAY_LETTERS = { 1: "M", 2: "T", 3: "W", 4: "R", 5: "F" };
  const SCHEDULE_TYPES = {
    rotating: { label: "Rotating letter days", blurb: "A–G style cycle. Letters only advance on school days, so breaks never throw the rotation off." },
    daily:    { label: "Same every day",       blurb: "Traditional schedule — the same periods meet every school day." },
    ab:       { label: "A/B block",            blurb: "Two alternating days. Usually half your periods meet on A days, the rest on B days." },
    weekday:  { label: "Weekday-based",        blurb: "Each weekday has its own pattern (e.g. late-start Wednesdays, block Thursday/Friday)." }
  };
  const DAY_NAMES = { M: "Monday", T: "Tuesday", W: "Wednesday", R: "Thursday", F: "Friday" };

  // ================================================================
  // Date helpers (local dates only — never UTC, so nothing slips a day)
  // ================================================================
  const pad = n => String(n).padStart(2, "0");
  const isoOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const dateOf = iso => { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d, 12); };
  const addDays = (iso, n) => { const d = dateOf(iso); d.setDate(d.getDate() + n); return isoOf(d); };
  const isISO = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ""));
  const fmt = iso => isISO(iso)
    ? dateOf(iso).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })
    : "—";
  const fmtYear = iso => isISO(iso)
    ? dateOf(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
    : "—";
  function eachDate(startISO, endISO, fn) {
    if (!isISO(startISO) || !isISO(endISO) || startISO > endISO) return;
    for (let iso = startISO, guard = 0; iso <= endISO && guard < 800; iso = addDays(iso, 1), guard++) fn(iso, dateOf(iso).getDay());
  }
  const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const uid = () => Math.random().toString(36).slice(2, 9);

  /** Parse many human date formats → YYYY-MM-DD (or "" if unknown). */
  function parseLooseDate(raw) {
    const v = String(raw || "").trim().replace(/^"|"$/g, "");
    if (!v) return "";
    let m;
    if ((m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
    if ((m = v.match(/^(\d{4})(\d{2})(\d{2})$/))) return `${m[1]}-${m[2]}-${m[3]}`;
    if ((m = v.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/))) {
      let y = Number(m[3]); if (y < 100) y += 2000;
      return `${y}-${pad(m[1])}-${pad(m[2])}`;
    }
    const d = new Date(v.replace(/(\d)(st|nd|rd|th)\b/i, "$1"));
    return isNaN(d) ? "" : isoOf(d);
  }

  // ================================================================
  // Event classification
  // ================================================================
  const OFF_RE = /\bno school\b|\bno classes\b|school closed|\bclosed\b|holiday|\bbreak\b|vacation|recess|teacher (work ?day|planning|in-?service)|work ?day|in-?service|professional (development|learning)|\bpd day\b|no students|student holiday|staff development|records day|labor day|thanksgiving|christmas|new year'?s day|martin luther king|\bmlk\b|presidents'? day|memorial day|veterans'? day|columbus day|indigenous peoples'? day|good friday|juneteenth|independence day|snow day|inclement weather/i;
  const NOT_OFF_RE = /early (release|dismissal)|half[- ]day|late (start|arrival)|delayed opening/i;

  function classify(title, typeHint) {
    const hint = String(typeHint || "").toLowerCase();
    if (/no ?school|off|holiday|closed|break/.test(hint)) return "off";
    if (/ignore|skip/.test(hint)) return "ignore";
    if (hint && /event|special|note/.test(hint)) return "event";
    if (NOT_OFF_RE.test(title)) return "event";
    if (OFF_RE.test(title)) return "off";
    return "event";
  }

  // ================================================================
  // Parsers
  // ================================================================
  function parseICS(text) {
    const lines = String(text).replace(/\r\n?/g, "\n").replace(/\n[ \t]/g, "").split("\n");
    const events = [];
    let cur = null;
    const unescape = s => s.replace(/\\n/gi, " ").replace(/\\([,;\\])/g, "$1").trim();
    const icsDate = (key, value) => {
      // DTSTART;VALUE=DATE:20261126  |  DTSTART:20261126T130000Z  |  DTSTART;TZID=...:20261126T080000
      const m = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?/);
      if (!m) return { iso: "", allDay: true };
      if (m[4] && m[7]) {
        const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]));
        return { iso: isoOf(d), allDay: false };
      }
      return { iso: `${m[1]}-${m[2]}-${m[3]}`, allDay: !m[4] };
    };
    for (const line of lines) {
      if (line === "BEGIN:VEVENT") { cur = {}; continue; }
      if (line === "END:VEVENT") {
        if (cur && cur.start) {
          let end = cur.start;
          if (cur.end) end = cur.endAllDay ? addDays(cur.end, -1) : cur.end; // all-day DTEND is exclusive
          if (end < cur.start) end = cur.start;
          events.push({ start: cur.start, end, title: cur.title || "(untitled)", category: cur.category || "", repeats: !!cur.rrule });
        }
        cur = null; continue;
      }
      if (!cur) continue;
      const idx = line.indexOf(":");
      if (idx < 0) continue;
      const key = line.slice(0, idx).toUpperCase();
      const value = line.slice(idx + 1);
      const name = key.split(";")[0];
      if (name === "DTSTART") cur.start = icsDate(key, value).iso;
      else if (name === "DTEND") { const r = icsDate(key, value); cur.end = r.iso; cur.endAllDay = r.allDay; }
      else if (name === "SUMMARY") cur.title = unescape(value);
      else if (name === "CATEGORIES") cur.category = unescape(value);
      else if (name === "RRULE") cur.rrule = value;
    }
    return events;
  }

  function splitCSVLine(line) {
    const out = []; let cell = ""; let q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) {
        if (c === '"' && line[i + 1] === '"') { cell += '"'; i++; }
        else if (c === '"') q = false;
        else cell += c;
      } else if (c === '"') q = true;
      else if (c === "," || c === "\t") { out.push(cell); cell = ""; }
      else cell += c;
    }
    out.push(cell);
    return out.map(s => s.trim());
  }

  function parseCSV(text) {
    const rows = String(text).replace(/^﻿/, "").replace(/\r\n?/g, "\n").split("\n").filter(l => l.trim()).map(splitCSVLine);
    if (!rows.length) return [];
    const header = rows[0].map(h => h.toLowerCase());
    const hasHeader = header.some(h => /date|event|title|name|summary|type/.test(h));
    const find = re => header.findIndex(h => re.test(h));
    let iStart = hasHeader ? find(/^(start|date|start date|from|day)/) : 0;
    let iEnd = hasHeader ? find(/^(end|end date|to|through|thru)/) : -1;
    let iTitle = hasHeader ? find(/event|title|name|summary|description|subject/) : 1;
    let iType = hasHeader ? find(/type|category|kind|school\?|status/) : 2;
    if (iStart < 0) iStart = 0;
    if (iTitle < 0) iTitle = iStart === 0 ? 1 : 0;
    const body = hasHeader ? rows.slice(1) : rows;
    const events = [];
    body.forEach(r => {
      let rawStart = r[iStart] || "";
      let rawEnd = iEnd >= 0 ? (r[iEnd] || "") : "";
      // "11/26/2026 - 11/28/2026" in one cell
      const range = rawStart.split(/\s+(?:-|–|—|to|through|thru)\s+/i);
      if (range.length === 2 && !rawEnd) { rawStart = range[0]; rawEnd = range[1]; }
      const start = parseLooseDate(rawStart);
      if (!start) return;
      let end = parseLooseDate(rawEnd) || start;
      if (end < start) end = start;
      events.push({ start, end, title: r[iTitle] || "(untitled)", category: iType >= 0 ? (r[iType] || "") : "" });
    });
    return events;
  }

  function parseCalendarFile(name, text) {
    const isICS = /\.ics$/i.test(name) || /BEGIN:VCALENDAR/.test(text);
    const raw = isICS ? parseICS(text) : parseCSV(text);
    return raw.map(e => ({
      id: uid(),
      start: e.start,
      end: e.end,
      title: e.title,
      kind: classify(e.title, e.category),
      note: e.repeats ? "repeats — only the first date was imported" : ""
    }));
  }

  // ================================================================
  // Calendar generation
  // ================================================================
  function lettersForType(type, lettersText) {
    if (type === "daily") return ["A"];
    if (type === "ab") return ["A", "B"];
    if (type === "weekday") return ["M", "T", "W", "R", "F"];
    const list = String(lettersText || "")
      .split(/[\s,]+/).map(s => s.trim().toUpperCase()).filter(s => /^[A-Z]$/.test(s));
    return Array.from(new Set(list));
  }

  function defaultRules(type, letters, periods) {
    const all = Array.from({ length: periods }, (_, i) => i + 1);
    const rules = {};
    if (type === "ab") {
      const half = Math.ceil(periods / 2);
      rules.A = all.slice(0, half);
      rules.B = all.slice(half).length ? all.slice(half) : all.slice();
      return rules;
    }
    letters.forEach(L => { rules[L] = all.slice(); });
    return rules;
  }

  /** Expand events → { iso: label } for no-school days and { iso: [labels] } for events. */
  function expandEvents(events, startISO, endISO) {
    const off = {}, special = {};
    (events || []).forEach(ev => {
      if (ev.kind === "ignore") return;
      eachDate(ev.start, ev.end || ev.start, (iso, dow) => {
        if (iso < startISO || iso > endISO) return;
        if (ev.kind === "off") {
          if (dow === 0 || dow === 6) return;
          off[iso] = off[iso] ? `${off[iso]} / ${ev.title}` : ev.title;
        } else {
          (special[iso] = special[iso] || []).push(ev.title);
        }
      });
    });
    return { off, special };
  }

  function buildDays(cfg) {
    const { off } = expandEvents(cfg.events, cfg.start, cfg.end);
    const days = [];
    let i = 0;
    eachDate(cfg.start, cfg.end, (iso, dow) => {
      if (dow === 0 || dow === 6) { days.push({ date: iso, letter: "" }); return; }
      if (off[iso]) { days.push({ date: iso, letter: "OFF", baseLetter: "", label: off[iso] }); return; }
      const L = cfg.scheduleType === "weekday" ? WEEKDAY_LETTERS[dow] : cfg.letters[i % cfg.letters.length];
      i++;
      days.push({ date: iso, letter: L, baseLetter: L });
    });
    return days;
  }

  function dayTypeName(type, L) {
    if (type === "daily") return "Every day";
    if (type === "weekday") return DAY_NAMES[L] || L;
    return `${L} day`;
  }

  function schoolYearLabel(startISO, endISO) {
    const a = (startISO || "").slice(0, 4), b = (endISO || "").slice(2, 4);
    return a && b ? `${a}–${b}` : "";
  }

  // ================================================================
  // Wizard state
  // ================================================================
  let st = null;

  function freshState(mode) {
    const pack = mode === "edit" && typeof getActivePack === "function" ? getActivePack() : null;
    const periods = Math.max(1, Number(pack?.periodCount) || 7);
    const type = pack?.scheduleType || (pack ? "rotating" : "rotating");
    const letters = pack?.letters?.length ? pack.letters.map(String) : ["A", "B", "C", "D", "E", "F", "G"];
    const classes = {};
    try {
      Object.entries(teacherSchedule || {}).forEach(([p, name]) => { if (name) classes[p] = name; });
    } catch (e) { /* teacherSchedule not ready */ }
    return {
      mode,                         // "new" | "edit"
      step: 0,
      editPackId: pack?.id || null,
      schoolName: pack?.schoolName || "",
      start: pack?.start || "",
      end: pack?.end || "",
      periods,
      events: JSON.parse(JSON.stringify(pack?.schoolEvents || [])),
      scheduleType: type,
      lettersText: letters.join(","),
      rules: pack?.rotationRules ? JSON.parse(JSON.stringify(pack.rotationRules)) : defaultRules(type, lettersForType(type, letters.join(",")), periods),
      classes,
      fileNote: ""
    };
  }

  const STEPS = [
    { key: "basics",   title: "School year" },
    { key: "calendar", title: "School calendar" },
    { key: "schedule", title: "Class schedule" },
    { key: "classes",  title: "Your classes" },
    { key: "review",   title: "Review" }
  ];

  function currentLetters() { return lettersForType(st.scheduleType, st.lettersText); }

  /** Keep rules in sync with letters/period count without losing the teacher's checkboxes. */
  function syncRules() {
    const letters = currentLetters();
    const all = Array.from({ length: st.periods }, (_, i) => i + 1);
    const next = {};
    const defaults = defaultRules(st.scheduleType, letters, st.periods);
    letters.forEach(L => {
      const prev = Array.isArray(st.rules[L]) ? st.rules[L].filter(p => p <= st.periods) : null;
      next[L] = prev && prev.length ? prev : (defaults[L] || all.slice());
    });
    st.rules = next;
  }

  // ================================================================
  // UI shell
  // ================================================================
  function ensureShell() {
    if (document.getElementById("upWizard")) return;
    const el = document.createElement("div");
    el.id = "upWizard";
    el.className = "up-backdrop";
    el.innerHTML = `
      <div class="up-modal" role="dialog" aria-modal="true" aria-labelledby="upWizTitle">
        <div class="up-head">
          <div>
            <div id="upWizTitle" class="up-title">🏫 School setup</div>
            <ol id="upSteps" class="up-steps"></ol>
          </div>
          <button type="button" class="secondary up-close" id="upWizClose" aria-label="Close">✕</button>
        </div>
        <div id="upBody" class="up-body"></div>
        <div class="up-foot">
          <button type="button" class="secondary" id="upBack">◀ Back</button>
          <span id="upFootMsg" class="up-foot-msg"></span>
          <button type="button" id="upNext">Next ▶</button>
        </div>
      </div>`;
    document.body.appendChild(el);
    el.querySelector("#upWizClose").onclick = close;
    el.querySelector("#upBack").onclick = () => go(st.step - 1);
    el.querySelector("#upNext").onclick = () => {
      if (st.step === STEPS.length - 1) finish();
      else go(st.step + 1);
    };
    el.addEventListener("click", e => { if (e.target === el && confirm("Close setup? Nothing has been saved yet.")) close(); });
  }

  function open(mode = "new", stepKey) {
    ensureShell();
    st = freshState(mode);
    const idx = stepKey ? STEPS.findIndex(s => s.key === stepKey) : 0;
    document.getElementById("upWizard").classList.add("show");
    document.body.classList.add("up-lock");
    render(Math.max(0, idx));
  }

  function close() {
    document.getElementById("upWizard")?.classList.remove("show");
    document.body.classList.remove("up-lock");
  }

  function validate(step) {
    if (step >= 1) {
      if (!st.schoolName.trim()) return "Enter your school's name.";
      if (!isISO(st.start) || !isISO(st.end)) return "Enter the first and last day of school.";
      if (st.start > st.end) return "The first day must be before the last day.";
      if (dateOf(st.end) - dateOf(st.start) > 400 * 864e5) return "That date range is longer than a school year.";
    }
    if (step >= 3) {
      const letters = currentLetters();
      if (!letters.length) return "Enter at least one day letter (e.g. A,B,C,D).";
      const empty = letters.filter(L => !(st.rules[L] || []).length);
      if (empty.length) return `Pick at least one period that meets on: ${empty.map(L => dayTypeName(st.scheduleType, L)).join(", ")}.`;
    }
    return "";
  }

  function go(step) {
    if (step < 0) return;
    if (step > st.step) {
      const problem = validate(step);
      if (problem) { flash(problem); return; }
    }
    render(step);
  }

  function flash(msg) {
    const el = document.getElementById("upFootMsg");
    if (!el) return;
    el.textContent = msg;
    el.classList.add("err");
    clearTimeout(flash._t);
    flash._t = setTimeout(() => { el.textContent = ""; el.classList.remove("err"); }, 4500);
  }

  function render(step) {
    st.step = step;
    document.getElementById("upSteps").innerHTML = STEPS.map((s, i) =>
      `<li class="${i === step ? "on" : i < step ? "done" : ""}">${i + 1}. ${esc(s.title)}</li>`).join("");
    document.getElementById("upBack").style.visibility = step === 0 ? "hidden" : "visible";
    document.getElementById("upNext").textContent =
      step === STEPS.length - 1 ? (st.mode === "edit" ? "Save changes ✓" : "Create my planner ✓") : "Next ▶";
    document.getElementById("upFootMsg").textContent = "";
    const body = document.getElementById("upBody");
    body.innerHTML = "";
    ({ basics: renderBasics, calendar: renderCalendarStep, schedule: renderSchedule, classes: renderClasses, review: renderReview })[STEPS[step].key](body);
    body.scrollTop = 0;
  }

  // ---------------- Step 1: basics ----------------
  function renderBasics(body) {
    body.innerHTML = `
      <p class="up-lead">Tell us about your school year. Weekends are skipped automatically; you'll add breaks and holidays on the next step.</p>
      <div class="up-grid">
        <label>School name<input id="upSchool" type="text" placeholder="e.g. Lincoln High School" value="${esc(st.schoolName)}"></label>
        <label>Class periods (or blocks) per day<input id="upPeriods" type="number" min="1" max="12" value="${st.periods}"></label>
        <label>First day of school<input id="upStart" type="date" value="${esc(st.start)}"></label>
        <label>Last day of school<input id="upEnd" type="date" value="${esc(st.end)}"></label>
      </div>
      <p class="up-hint">Tip: if your school calendar file lists "First Day of School" and "Last Day of School," we'll offer to fill these in for you on the next step.</p>
      ${st.mode === "edit" ? `<p class="up-warn">Editing your current calendar. Units, notes, and assessments stay put and re-flow onto the new class days. Any letter-day changes you made by hand on individual days will be reset.</p>` : ""}`;
    body.querySelector("#upSchool").oninput = e => { st.schoolName = e.target.value; };
    body.querySelector("#upStart").onchange = e => { st.start = e.target.value; };
    body.querySelector("#upEnd").onchange = e => { st.end = e.target.value; };
    body.querySelector("#upPeriods").onchange = e => {
      st.periods = Math.max(1, Math.min(12, parseInt(e.target.value, 10) || 7));
      e.target.value = st.periods;
      syncRules();
    };
  }

  // ---------------- Step 2: school calendar import ----------------
  function renderCalendarStep(body) {
    const inYear = ev => !(ev.end < st.start || ev.start > st.end);
    const { off } = expandEvents(st.events, st.start, st.end);
    const offCount = Object.keys(off).length;
    const eventCount = st.events.filter(e => e.kind === "event" && inYear(e)).length;
    const outside = st.events.filter(e => !inYear(e)).length;

    const firstDay = st.events.find(e => /first day (of school|for students|of classes)/i.test(e.title));
    const lastDay = st.events.find(e => /last day (of school|for students|of classes)/i.test(e.title));
    const suggest = [];
    if (firstDay && firstDay.start !== st.start) suggest.push(`first day → ${fmtYear(firstDay.start)}`);
    if (lastDay && lastDay.start !== st.end) suggest.push(`last day → ${fmtYear(lastDay.start)}`);

    body.innerHTML = `
      <p class="up-lead">Upload your school's calendar so breaks and holidays are skipped when your classes are scheduled. You can also add or change any event by hand.</p>
      <div class="up-drop" id="upDrop">
        <div><strong>Drop a .ics or .csv file here</strong> or <label class="up-linkbtn">choose a file<input id="upFile" type="file" accept=".ics,.csv,.txt,text/calendar,text/csv" hidden></label></div>
        <div class="up-hint">.ics: export from Google Calendar / Outlook (or download your school's calendar feed). &nbsp;.csv: columns <code>Start, End, Event, Type</code> —
          <a href="#" id="upTemplate">download a template</a>.</div>
        ${st.fileNote ? `<div class="up-ok">${esc(st.fileNote)}</div>` : ""}
      </div>
      ${suggest.length ? `<div class="up-suggest">Found in your calendar: ${esc(suggest.join(", "))}. <button type="button" class="up-mini" id="upUseDates">Use these dates</button></div>` : ""}
      <div class="up-summary">
        <span class="up-pill off">${offCount} no-school weekday${offCount === 1 ? "" : "s"}</span>
        <span class="up-pill ev">${eventCount} event${eventCount === 1 ? "" : "s"}</span>
        ${outside ? `<span class="up-pill muted">${outside} outside ${esc(fmtYear(st.start))} – ${esc(fmtYear(st.end))} (ignored)</span>` : ""}
      </div>
      <div class="up-table-wrap">
        <table class="up-table">
          <thead><tr><th>Start</th><th>End</th><th>Event</th><th>Type</th><th></th></tr></thead>
          <tbody id="upEvRows"></tbody>
        </table>
      </div>
      <div class="up-row-actions">
        <button type="button" class="secondary" id="upAddEv">+ Add event</button>
        <button type="button" class="secondary" id="upAddBreak">+ Add break</button>
        ${st.events.length ? `<button type="button" class="secondary" id="upClearEv">Clear all</button>` : ""}
      </div>
      <p class="up-hint"><strong>No school</strong> = students aren't in class (holidays, breaks, teacher workdays). Your classes skip these days.
        <strong>Event</strong> = shows as a tag on the calendar but classes still meet (early release, picture day, exams). <strong>Ignore</strong> = leave it off.</p>`;

    const rowsEl = body.querySelector("#upEvRows");
    const sorted = st.events.slice().sort((a, b) => a.start.localeCompare(b.start));
    rowsEl.innerHTML = sorted.length ? sorted.map(ev => `
      <tr data-id="${ev.id}" class="${inYear(ev) ? "" : "up-outside"} kind-${ev.kind}">
        <td><input type="date" data-f="start" value="${esc(ev.start)}"></td>
        <td><input type="date" data-f="end" value="${esc(ev.end)}"></td>
        <td><input type="text" data-f="title" value="${esc(ev.title)}">${ev.note ? `<div class="up-note">${esc(ev.note)}</div>` : ""}</td>
        <td><select data-f="kind">
              <option value="off" ${ev.kind === "off" ? "selected" : ""}>No school</option>
              <option value="event" ${ev.kind === "event" ? "selected" : ""}>Event</option>
              <option value="ignore" ${ev.kind === "ignore" ? "selected" : ""}>Ignore</option>
            </select></td>
        <td><button type="button" class="up-del" title="Remove">✕</button></td>
      </tr>`).join("")
      : `<tr><td colspan="5" class="up-empty">No events yet. Upload a file or add them by hand — or skip this step and mark days off later.</td></tr>`;

    rowsEl.querySelectorAll("tr[data-id]").forEach(tr => {
      const ev = st.events.find(e => e.id === tr.dataset.id);
      tr.querySelectorAll("[data-f]").forEach(input => {
        input.onchange = () => {
          const f = input.dataset.f;
          ev[f] = input.value;
          if (f === "start" && (!ev.end || ev.end < ev.start)) ev.end = ev.start;
          if (f === "end" && ev.end < ev.start) ev.end = ev.start;
          ev.note = "";
          renderCalendarStep(body);
        };
      });
      tr.querySelector(".up-del").onclick = () => { st.events = st.events.filter(e => e.id !== ev.id); renderCalendarStep(body); };
    });

    const addRow = (kind, title) => {
      const d = isISO(st.start) ? st.start : isoOf(new Date());
      st.events.push({ id: uid(), start: d, end: d, title, kind, note: "" });
      renderCalendarStep(body);
      const last = rowsEl.ownerDocument.querySelector(`#upEvRows tr[data-id="${st.events[st.events.length - 1].id}"] input[data-f="title"]`);
      last?.focus(); last?.select();
    };
    body.querySelector("#upAddEv").onclick = () => addRow("event", "New event");
    body.querySelector("#upAddBreak").onclick = () => addRow("off", "Break");
    body.querySelector("#upClearEv")?.addEventListener("click", () => {
      if (confirm("Remove all events from this list?")) { st.events = []; st.fileNote = ""; renderCalendarStep(body); }
    });
    body.querySelector("#upUseDates")?.addEventListener("click", () => {
      if (firstDay) st.start = firstDay.start;
      if (lastDay) st.end = lastDay.start;
      renderCalendarStep(body);
    });
    body.querySelector("#upTemplate").onclick = e => { e.preventDefault(); downloadTemplate(); };

    const handleFiles = files => {
      const file = files && files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const parsed = parseCalendarFile(file.name, String(reader.result || ""));
          if (!parsed.length) { flash(`Couldn't find any events in ${file.name}.`); return; }
          // Merge: skip exact duplicates of events already in the list.
          const key = e => `${e.start}|${e.end}|${e.title.toLowerCase()}`;
          const have = new Set(st.events.map(key));
          const added = parsed.filter(e => !have.has(key(e)));
          st.events.push(...added);
          const offN = added.filter(e => e.kind === "off").length;
          st.fileNote = `✓ ${file.name}: added ${added.length} event${added.length === 1 ? "" : "s"} (${offN} marked No school${parsed.length - added.length ? `, ${parsed.length - added.length} duplicates skipped` : ""}). Check the Type column below.`;
          renderCalendarStep(body);
        } catch (err) {
          console.error(err);
          flash(`Couldn't read ${file.name}: ${err.message}`);
        }
      };
      reader.readAsText(file);
    };
    body.querySelector("#upFile").onchange = e => handleFiles(e.target.files);
    const drop = body.querySelector("#upDrop");
    ["dragenter", "dragover"].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.add("hot"); }));
    ["dragleave", "drop"].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.remove("hot"); }));
    drop.addEventListener("drop", e => handleFiles(e.dataTransfer?.files));
  }

  function downloadTemplate() {
    const y = isISO(st.start) ? Number(st.start.slice(0, 4)) : new Date().getFullYear();
    const csv = [
      "Start,End,Event,Type",
      `${y}-09-07,,Labor Day,No school`,
      `${y}-10-09,,Picture Day,Event`,
      `${y}-11-25,${y}-11-27,Thanksgiving Break,No school`,
      `${y}-12-18,,Early Release,Event`,
      `${y}-12-21,${y + 1}-01-01,Winter Break,No school`,
      `${y + 1}-01-18,,Teacher Workday,No school`
    ].join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = "school-calendar-template.csv";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  // ---------------- Step 3: schedule type + period map ----------------
  function renderSchedule(body) {
    syncRules();
    const letters = currentLetters();
    const periods = Array.from({ length: st.periods }, (_, i) => i + 1);
    const preview = buildDays({ start: st.start, end: st.end, events: st.events, scheduleType: st.scheduleType, letters })
      .filter(d => d.letter && d.letter !== "OFF").slice(0, 10);

    body.innerHTML = `
      <p class="up-lead">How does your school's schedule work?</p>
      <div class="up-types">
        ${Object.entries(SCHEDULE_TYPES).map(([k, t]) => `
          <label class="up-type ${st.scheduleType === k ? "on" : ""}">
            <input type="radio" name="upType" value="${k}" ${st.scheduleType === k ? "checked" : ""}>
            <strong>${esc(t.label)}</strong><span>${esc(t.blurb)}</span>
          </label>`).join("")}
      </div>
      ${st.scheduleType === "rotating" ? `
        <label class="up-inline">Day letters, in order
          <input id="upLetters" type="text" value="${esc(st.lettersText)}" placeholder="A,B,C,D,E,F,G">
        </label>` : ""}
      <h4 class="up-h4">Which periods meet on each day?</h4>
      <div class="up-table-wrap">
        <table class="up-table up-map">
          <thead><tr><th></th>${periods.map(p => `<th>P${p}</th>`).join("")}<th></th></tr></thead>
          <tbody>
            ${letters.map(L => `
              <tr data-letter="${L}">
                <th>${esc(dayTypeName(st.scheduleType, L))}</th>
                ${periods.map(p => `<td><input type="checkbox" data-p="${p}" ${(st.rules[L] || []).includes(p) ? "checked" : ""} aria-label="${esc(dayTypeName(st.scheduleType, L))} period ${p}"></td>`).join("")}
                <td class="up-map-actions"><button type="button" class="up-mini" data-all>All</button><button type="button" class="up-mini" data-none>None</button></td>
              </tr>`).join("")}
          </tbody>
        </table>
      </div>
      ${st.scheduleType === "rotating" ? `<p class="up-hint">Drop rotation? Uncheck the periods that don't meet on each letter day. Order within a day (and bell times) can be fine-tuned later under <em>Custom calendar → Edit period map / Edit M-F Times</em>.</p>` : ""}
      <h4 class="up-h4">Preview — first ${preview.length} school days</h4>
      <div class="up-preview">${preview.length ? preview.map(d =>
        `<span><b>${esc(fmt(d.date))}</b> ${esc(dayTypeName(st.scheduleType, d.letter))}</span>`).join("") : "<em>Set your school dates on step 1 to see a preview.</em>"}</div>`;

    body.querySelectorAll('input[name="upType"]').forEach(r => r.onchange = () => {
      st.scheduleType = r.value;
      if (r.value === "rotating" && !lettersForType("rotating", st.lettersText).length) st.lettersText = "A,B,C,D,E,F,G";
      st.rules = {};
      syncRules();
      renderSchedule(body);
    });
    body.querySelector("#upLetters")?.addEventListener("change", e => {
      st.lettersText = e.target.value;
      syncRules();
      renderSchedule(body);
    });
    body.querySelectorAll("tr[data-letter]").forEach(tr => {
      const L = tr.dataset.letter;
      const read = () => { st.rules[L] = [...tr.querySelectorAll("input[data-p]:checked")].map(i => Number(i.dataset.p)); };
      tr.querySelectorAll("input[data-p]").forEach(cb => cb.onchange = read);
      tr.querySelector("[data-all]").onclick = () => { tr.querySelectorAll("input[data-p]").forEach(cb => cb.checked = true); read(); };
      tr.querySelector("[data-none]").onclick = () => { tr.querySelectorAll("input[data-p]").forEach(cb => cb.checked = false); read(); };
    });
  }

  // ---------------- Step 4: classes ----------------
  function renderClasses(body) {
    let known = [];
    try { known = JSON.parse(localStorage.getItem("knownClasses") || "[]"); } catch (e) { known = []; }
    const letters = currentLetters();
    const meets = p => letters.filter(L => (st.rules[L] || []).includes(p)).map(L => dayTypeName(st.scheduleType, L));
    body.innerHTML = `
      <p class="up-lead">What do you teach each period? Leave a period blank if it's your planning period or you don't teach it.</p>
      <datalist id="upKnown">${known.map(k => `<option value="${esc(k)}">`).join("")}</datalist>
      <div class="up-classes">
        ${Array.from({ length: st.periods }, (_, i) => i + 1).map(p => `
          <label class="up-class">
            <span class="up-class-p">Period ${p}<small>${esc(meets(p).length === letters.length ? "every day" : meets(p).join(", ") || "never meets")}</small></span>
            <input type="text" list="upKnown" data-p="${p}" placeholder="e.g. AP Statistics" value="${esc(st.classes[p] || "")}">
          </label>`).join("")}
      </div>
      <p class="up-hint">Teaching the same course in two periods? Type the same name in both — units can be copied between them later.</p>`;
    body.querySelectorAll("input[data-p]").forEach(inp => inp.oninput = () => {
      const v = inp.value.trim();
      if (v) st.classes[inp.dataset.p] = v; else delete st.classes[inp.dataset.p];
    });
  }

  // ---------------- Step 5: review ----------------
  function renderReview(body) {
    const letters = currentLetters();
    const days = buildDays({ start: st.start, end: st.end, events: st.events, scheduleType: st.scheduleType, letters });
    const schoolDays = days.filter(d => d.letter && d.letter !== "OFF").length;
    const offDays = days.filter(d => d.letter === "OFF").length;
    const { special } = expandEvents(st.events, st.start, st.end);
    const classList = Object.entries(st.classes).sort((a, b) => a[0] - b[0]);
    const perClass = classList.map(([p, name]) => {
      const n = days.filter(d => d.letter && d.letter !== "OFF" && (st.rules[d.letter] || []).includes(Number(p))).length;
      return `<li><b>P${p}</b> ${esc(name)} — <span class="up-muted">${n} class meetings</span></li>`;
    }).join("");
    body.innerHTML = `
      <div class="up-review">
        <div><span class="up-k">Planner</span><span>${esc(st.schoolName)} ${esc(schoolYearLabel(st.start, st.end))}</span></div>
        <div><span class="up-k">School year</span><span>${esc(fmtYear(st.start))} – ${esc(fmtYear(st.end))}</span></div>
        <div><span class="up-k">School days</span><span>${schoolDays} instructional · ${offDays} no-school weekdays · ${Object.keys(special).length} days with events</span></div>
        <div><span class="up-k">Schedule</span><span>${esc(SCHEDULE_TYPES[st.scheduleType].label)}${st.scheduleType === "rotating" ? ` (${esc(letters.join(", "))})` : ""} · ${st.periods} periods</span></div>
      </div>
      <h4 class="up-h4">Your classes</h4>
      ${classList.length ? `<ul class="up-class-sum">${perClass}</ul>` : `<p class="up-hint">No classes entered — you can add them later in the sidebar under <em>Teacher Schedule</em>.</p>`}
      <p class="up-hint">Next: open <strong>📚 Units per Class</strong> in the sidebar to add your first unit. Units are paced by class meeting, so breaks and snow days shift them automatically.</p>
      ${st.mode === "edit" ? `<p class="up-warn">Saving replaces this calendar's school days and imported events. Your units, notes, and assessments are kept.</p>` : ""}`;
  }

  // ================================================================
  // Apply to the planner
  // ================================================================
  function finish() {
    const problem = validate(STEPS.length);
    if (problem) { flash(problem); return; }
    syncRules();
    const letters = currentLetters();
    const days = buildDays({ start: st.start, end: st.end, events: st.events, scheduleType: st.scheduleType, letters });
    const name = `${st.schoolName.trim()} ${schoolYearLabel(st.start, st.end)}`.trim();
    const rules = {};
    letters.forEach(L => { rules[L] = (st.rules[L] || []).slice().sort((a, b) => a - b); });
    const events = st.events.map(e => ({ id: e.id, start: e.start, end: e.end || e.start, title: e.title, kind: e.kind }));

    let pack;
    if (st.mode === "edit" && st.editPackId) {
      pack = savedPacks.find(p => p.id === st.editPackId);
    }
    const fields = {
      name,
      schoolName: st.schoolName.trim(),
      start: st.start,
      end: st.end,
      letters,
      periodCount: st.periods,
      rotationRules: rules,
      skipWeekends: true,
      scheduleType: st.scheduleType,
      schoolEvents: events,
      days
    };
    if (pack) {
      Object.assign(pack, fields);
    } else {
      pack = { id: "pack-" + Date.now(), ...fields };
      savedPacks.push(pack);
    }
    savePackLibrary();
    usePack(pack.id); // switching to a new pack clears tags, so events are added after this

    // Imported school events → special-day tags (replace any from a previous import)
    const { special } = expandEvents(events, st.start, st.end);
    specialDays = (Array.isArray(specialDays) ? specialDays : []).filter(d => !String(d.id || "").startsWith("schoolcal-"));
    Object.entries(special).forEach(([iso, titles]) => {
      titles.forEach((title, i) => {
        specialDays.push({
          id: `schoolcal-${iso}-${i}`,
          date: iso,
          label: title,
          badgeText: "SCH",
          color: "#bfdbfe",
          appliesTo: "day",
          periods: []
        });
      });
    });
    saveSpecialDays();

    // Classes
    const names = new Set();
    for (let p = 1; p <= 12; p++) {
      const v = (st.classes[p] || "").trim();
      if (v && p <= st.periods) { teacherSchedule[p] = v; names.add(v); }
      else delete teacherSchedule[p];
    }
    saveScheduleToStorage();
    try {
      const known = JSON.parse(localStorage.getItem("knownClasses") || "[]");
      names.forEach(n => { if (!known.includes(n)) known.push(n); });
      localStorage.setItem("knownClasses", JSON.stringify(known));
    } catch (e) { /* ignore */ }

    if (typeof saveCurrentProfile === "function") saveCurrentProfile(false);
    if (typeof refreshAllData === "function") refreshAllData();
    if (typeof renderScheduleFields === "function") renderScheduleFields();
    if (typeof renderRotationLegend === "function") renderRotationLegend();
    if (typeof renderCycleColorPickers === "function") renderCycleColorPickers();
    if (typeof renderSpecialDays === "function") renderSpecialDays();
    if (typeof updateAppTitle === "function") updateAppTitle();
    if (typeof refreshPackSelect === "function") refreshPackSelect();
    renderSidebarCard();
    close();
    if (typeof showProfileToast === "function") {
      showProfileToast(st.mode === "edit" ? `Updated ${name}` : `${name} is ready — add your first unit!`);
    }
  }

  // ================================================================
  // Sidebar card + help button + first-run
  // ================================================================
  function renderSidebarCard() {
    const config = document.getElementById("config");
    if (!config) return;
    let card = document.getElementById("upSetupCard");
    if (!card) {
      card = document.createElement("div");
      card.id = "upSetupCard";
      card.className = "config-section up-card";
      config.insertBefore(card, config.firstChild);
    }
    const pack = typeof getActivePack === "function" ? getActivePack() : null;
    const evN = pack?.schoolEvents?.length || 0;
    card.innerHTML = pack ? `
      <div class="up-card-title">🏫 School Setup</div>
      <div class="up-card-sub">${esc(pack.name)}<br>${esc(SCHEDULE_TYPES[pack.scheduleType || "rotating"].label)} · ${pack.periodCount || "?"} periods · ${evN} calendar event${evN === 1 ? "" : "s"}</div>
      <div class="up-card-btns">
        <button type="button" id="upCardEvents">📅 Update school calendar</button>
        <button type="button" class="secondary" id="upCardEdit">Edit setup</button>
        <button type="button" class="secondary" id="upCardNew">New school year…</button>
      </div>` : `
      <div class="up-card-title">🏫 School Setup</div>
      <div class="up-card-sub">No calendar yet. Import your school calendar and set up your classes to start planning.</div>
      <div class="up-card-btns"><button type="button" id="upCardNew">Start setup</button></div>`;
    card.querySelector("#upCardEvents")?.addEventListener("click", () => open("edit", "calendar"));
    card.querySelector("#upCardEdit")?.addEventListener("click", () => open("edit"));
    card.querySelector("#upCardNew")?.addEventListener("click", () => {
      if (pack && !confirm("Start a new school year calendar?\n\nTip: create a new profile first (Profile actions → New Profile) so this year's units stay with this year's calendar.")) return;
      open("new");
    });
  }

  function init() {
    renderSidebarCard();
    document.getElementById("openSetupWizardFromHelpBtn")?.addEventListener("click", () => {
      if (typeof closeHelp === "function") closeHelp();
      open(getActivePack && getActivePack() ? "edit" : "new");
    });
    // First run: nothing set up yet → open the wizard.
    const hasPack = typeof getActivePack === "function" && !!getActivePack();
    if (!hasPack && !(Array.isArray(savedPacks) && savedPacks.length)) {
      // The daily "highlights" popup has nothing to show yet — let setup take the stage.
      const hb = document.getElementById("welcomeHighlightsBackdrop");
      if (hb) hb.style.display = "none";
      open("new");
    }
    // Keep the card fresh when profiles/calendars change.
    if (typeof usePack === "function" && !usePack.__up) {
      const orig = usePack;
      window.usePack = function (...args) { const r = orig.apply(this, args); renderSidebarCard(); return r; };
      window.usePack.__up = true;
    }
  }

  // While setup is open, don't let the daily highlights popup cover it.
  if (typeof window.openWelcomeHighlights === "function") {
    const origHighlights = window.openWelcomeHighlights;
    window.openWelcomeHighlights = function (...args) {
      if (document.getElementById("upWizard")?.classList.contains("show")) return;
      return origHighlights.apply(this, args);
    };
  }

  // Expose for debugging/tests.
  window.UnitPacerSetup = { open, parseICS, parseCSV, classify, buildDays, expandEvents };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
