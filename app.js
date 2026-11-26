(() => {
  const STORAGE_KEY = "timetable_system_terms_v1";
  const CUSTOM_TEACHERS_KEY = "timetable_custom_teachers_v1";
  const DEFAULT_SCHOOL_WIDE = ["班會", "週會", "團體活動", "彈性教學", "彈性學習時間"];

  // 群科對照表（用於代課第二順位：同群科教師）
  const DEPT_CLUSTERS = {
    汽車科: ["機械科", "農機科", "電機科", "資訊科"],
    機械科: ["汽車科", "農機科", "電機科", "資訊科"],
    農機科: ["汽車科", "機械科", "畜保科"],
    畜保科: ["農機科"],
    電機科: ["資訊科", "汽車科", "機械科"],
    資訊科: ["電機科", "計概科"],
    計概科: ["資訊科", "電機科"],
    土木科: ["室設科"],
    室設科: ["土木科", "美術"],
    家政科: ["美術"],
    國文科: ["社概科"],
    社概科: ["國文科"],
    英語科: [],
    數學科: ["自然科"],
    自然科: ["數學科"],
  };

  function inferSubjectDept(subject) {
    if (!subject) return "";
    if (subject.includes("國語") || subject.includes("國文") || subject.includes("閱讀")) return "國文科";
    if (subject.includes("英語") || subject.includes("英文")) return "英語科";
    if (subject.includes("數學")) return "數學科";
    if (subject.includes("物理") || subject.includes("化學") || subject.includes("生物") || subject.includes("自然")) return "自然科";
    if (subject.includes("公民") || subject.includes("歷史") || subject.includes("地理")) return "社概科";
    if (subject.includes("體育") || subject.includes("健康")) return "體育";
    if (subject.includes("美術") || subject.includes("藝術")) return "美術";
    if (subject.includes("計算機")) return "計概科";
    if (subject.includes("國防")) return "軍訓";
    return "";
  }

  const state = {
    terms: {},
    currentTermId: "",
    browseMode: "teacher", // "teacher" | "class"
    browseDept: "全部",
    browseSearch: "",
    selectedEntityId: "", // teacher.id or class.name
    leavePlan: [], // [{ leaveDay, leavePeriod, className, leaveSubject, type, swapLabel, occupiedSlots: [{day, period}], text }]
    lastMatches: [],
    customTeachersByTerm: {}, // { termId: [ { id, name, department, isCustom: true, grid } ] }
    editingCustomId: "",
    editingCustomGrid: {},
    editingCellTarget: null,
  };

  // --- Utilities ---
  function loadTerms() {
    let saved = {};
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) saved = JSON.parse(raw);
    } catch (e) {
      console.warn("讀取 localStorage 失敗", e);
    }

    if (window.__DEFAULT_TIMETABLE_TERM__) {
      const def = window.__DEFAULT_TIMETABLE_TERM__;
      if (!saved[def.termId]) {
        saved[def.termId] = def;
      }
    }

    state.terms = saved;
    const ids = Object.keys(state.terms);
    if (ids.length > 0 && !state.terms[state.currentTermId]) {
      state.currentTermId = ids[0];
    }
  }

  function saveTerms() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.terms));
    } catch (e) {
      alert("瀏覽器儲存空間不足，無法儲存更多學年度資料。");
    }
  }

  function loadCustomTeachers() {
    try {
      const raw = localStorage.getItem(CUSTOM_TEACHERS_KEY);
      state.customTeachersByTerm = raw ? JSON.parse(raw) : {};
    } catch (e) {
      state.customTeachersByTerm = {};
    }
  }

  function saveCustomTeachers() {
    try {
      localStorage.setItem(CUSTOM_TEACHERS_KEY, JSON.stringify(state.customTeachersByTerm));
    } catch (e) {
      alert("瀏覽器儲存空間不足，無法儲存自訂教師。");
    }
  }

  function getMergedTeachers(term) {
    if (!term) return [];
    const customs = state.customTeachersByTerm[term.termId] || [];
    return [...term.teachers, ...customs];
  }

  function getTerm() {
    return state.terms[state.currentTermId] || null;
  }

  function isSchoolWide(subject, term) {
    if (!subject) return false;
    const kws = term?.schoolWideKeywords || DEFAULT_SCHOOL_WIDE;
    return kws.some((k) => subject.includes(k));
  }

  function escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // --- Tabs & Topbar ---
  function initTabs() {
    document.querySelectorAll(".tab-btn").forEach((btn) => {
      btn.addEventListener("click", () => switchTab(btn.dataset.tab));
    });
    document.getElementById("openImportTabBtn").addEventListener("click", () => {
      switchTab("import");
    });
  }

  function switchTab(tabId) {
    document.querySelectorAll(".tab-btn").forEach((b) => {
      b.classList.toggle("active", b.dataset.tab === tabId);
    });
    document.querySelectorAll(".tab-panel").forEach((p) => {
      p.classList.toggle("active", p.id === `tab-${tabId}`);
    });
    if (tabId === "import") renderSavedTerms();
  }

  function renderTopbar() {
    const sel = document.getElementById("termSelect");
    const ids = Object.keys(state.terms);
    sel.innerHTML = ids
      .map((id) => `<option value="${escapeHtml(id)}">${escapeHtml(state.terms[id].termLabel || id)}</option>`)
      .join("");
    sel.value = state.currentTermId;

    const term = getTerm();
    const summaryEl = document.getElementById("termSummaryText");
    if (term) {
      summaryEl.textContent = `${term.termLabel || term.termId}｜教師 ${term.teachers.length} 位｜班級 ${term.classes.length} 班`;
    } else {
      summaryEl.textContent = "尚無課表資料，請先匯入 JSON";
    }
  }

  // --- Browse Tab (Teacher / Class) ---
  function getEntities(term) {
    if (!term) return [];
    return state.browseMode === "teacher" ? getMergedTeachers(term) : term.classes;
  }

  function getDepartments(entities) {
    const set = new Set(["全部"]);
    entities.forEach((e) => set.add(e.department || "其他"));
    return Array.from(set);
  }

  function renderBrowseControls() {
    const term = getTerm();
    if (!term) return;

    document.getElementById("modeTeacherBtn").classList.toggle("active", state.browseMode === "teacher");
    document.getElementById("modeClassBtn").classList.toggle("active", state.browseMode === "class");

    const entities = getEntities(term);
    const depts = getDepartments(entities);
    if (!depts.includes(state.browseDept)) state.browseDept = "全部";

    // Dept pills
    const pillsEl = document.getElementById("browseDeptPills");
    pillsEl.innerHTML = depts
      .map(
        (d) =>
          `<button class="pill ${d === state.browseDept ? "active" : ""}" data-dept="${escapeHtml(d)}">${escapeHtml(d)}</button>`
      )
      .join("");
    pillsEl.querySelectorAll(".pill").forEach((p) => {
      p.addEventListener("click", () => {
        state.browseDept = p.dataset.dept;
        renderBrowseControls();
      });
    });

    // Filtered list
    const kw = state.browseSearch.trim().toLowerCase();
    const filtered = entities.filter((e) => {
      const deptOk = state.browseDept === "全部" || (e.department || "其他") === state.browseDept;
      if (!deptOk) return false;
      if (!kw) return true;
      const text =
        state.browseMode === "teacher"
          ? `${e.id} ${e.name} ${e.department}`.toLowerCase()
          : `${e.name} ${e.department} ${e.homeroomTeacher || ""}`.toLowerCase();
      return text.includes(kw);
    });

    // Dropdown
    const dd = document.getElementById("browseDropdown");
    dd.innerHTML = filtered
      .map((e) => {
        const val = state.browseMode === "teacher" ? e.id : e.name;
        const label =
          state.browseMode === "teacher"
            ? `${e.name}（${e.department}｜編號 ${e.id}）`
            : `${e.name}（${e.department}｜導師 ${e.homeroomTeacher || "-"}）`;
        return `<option value="${escapeHtml(val)}">${escapeHtml(label)}</option>`;
      })
      .join("");

    // Ensure valid selection
    const validIds = filtered.map((e) => (state.browseMode === "teacher" ? e.id : e.name));
    if (!validIds.includes(state.selectedEntityId)) {
      state.selectedEntityId = validIds[0] || "";
    }
    dd.value = state.selectedEntityId;

    // Entity Grid
    const gridEl = document.getElementById("browseEntityGrid");
    if (filtered.length === 0) {
      gridEl.innerHTML = `<span style="font-size:13px;color:var(--text-muted);">查無符合條件的項目</span>`;
    } else {
      gridEl.innerHTML = filtered
        .map((e) => {
          const val = state.browseMode === "teacher" ? e.id : e.name;
          const active = val === state.selectedEntityId ? "active" : "";
          const sub = state.browseMode === "teacher" ? e.department : `導:${e.homeroomTeacher || "-"}`;
          return `<button class="entity-chip ${active}" data-val="${escapeHtml(val)}">
            <span>${escapeHtml(e.name)}</span>
            <span class="sub">${escapeHtml(sub)}</span>
          </button>`;
        })
        .join("");

      gridEl.querySelectorAll(".entity-chip").forEach((chip) => {
        chip.addEventListener("click", () => {
          state.selectedEntityId = chip.dataset.val;
          renderBrowseControls();
          renderTimetable();
        });
      });
    }

    renderTimetable();
  }

  function renderTimetable() {
    const term = getTerm();
    const titleEl = document.getElementById("timetableTitle");
    const metaEl = document.getElementById("timetableMeta");
    const actionsEl = document.getElementById("browseQuickActions");
    const container = document.getElementById("timetableContainer");

    if (!term || !state.selectedEntityId) {
      titleEl.textContent = "請選擇教師或班級";
      metaEl.textContent = "";
      actionsEl.innerHTML = "";
      container.innerHTML = "";
      return;
    }

    const isTeacher = state.browseMode === "teacher";
    const entity = isTeacher
      ? getMergedTeachers(term).find((t) => t.id === state.selectedEntityId)
      : term.classes.find((c) => c.name === state.selectedEntityId);

    if (!entity) return;

    if (isTeacher) {
      titleEl.textContent = `教師課表：${entity.name}（${entity.department}）`;
      metaEl.textContent = `編號：${entity.id}`;
      actionsEl.innerHTML = `<button class="btn btn-primary btn-sm" id="jumpToLeaveBtn">🔄 以此教師安排請假調課</button>`;
      document.getElementById("jumpToLeaveBtn").addEventListener("click", () => {
        document.getElementById("leaveDeptFilter").value = "全部";
        renderLeaveTeacherSelect();
        document.getElementById("leaveTeacherSelect").value = entity.id;
        switchTab("leave");
      });
    } else {
      titleEl.textContent = `班級課表：${entity.name}（${entity.department}）`;
      metaEl.textContent = `導師：${entity.homeroomTeacher || "-"}`;
      actionsEl.innerHTML = "";
    }

    const days = term.days || ["一", "二", "三", "四", "五"];
    const periods = term.periods || [];

    let html = `<table class="timetable"><thead><tr><th>節次 / 時間</th>`;
    days.forEach((d) => {
      html += `<th>星期${escapeHtml(d)}</th>`;
    });
    html += `</tr></thead><tbody>`;

    periods.forEach((p) => {
      html += `<tr><td class="period-col">${escapeHtml(p.label)}<span class="period-time">${escapeHtml(p.time)}</span></td>`;
      days.forEach((d) => {
        const cell = entity.grid?.[p.key]?.[d];
        if (!cell) {
          html += `<td><span class="cell-empty">空堂</span></td>`;
          return;
        }
        if (cell.isUnavailable) {
          html += `<td class="cell-schoolwide"><span style="font-size:11px;color:var(--text-muted);">校外/不克調課</span></td>`;
          return;
        }
        const sw = cell.isSchoolWide || isSchoolWide(cell.subject, term);
        const clsName = sw ? "cell-schoolwide" : "";
        html += `<td class="${clsName}"><div class="cell-box">`;
        html += `<span class="cell-subject">${escapeHtml(cell.subject)}</span>`;

        if (isTeacher) {
          if (cell.className) {
            html += `<button class="cell-link" data-jump-class="${escapeHtml(cell.className)}">${escapeHtml(cell.className)}</button>`;
          }
          if (cell.isPartTime) {
            html += `<span class="badge badge-parttime">兼課</span>`;
          }
        } else {
          if (cell.teacherId) {
            html += `<button class="cell-link" data-jump-teacher="${escapeHtml(cell.teacherId)}">${escapeHtml(cell.teacherMasked)}</button>`;
          } else if (cell.teacherMasked) {
            html += `<span style="font-size:12px;color:var(--text-muted);">${escapeHtml(cell.teacherMasked)}</span>`;
          }
        }

        if (sw) {
          html += `<span class="badge badge-schoolwide">共同時間</span>`;
        }
        html += `</div></td>`;
      });
      html += `</tr>`;
    });

    html += `</tbody></table>`;
    container.innerHTML = html;

    // Cross jump links
    container.querySelectorAll("[data-jump-class]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.browseMode = "class";
        state.browseDept = "全部";
        state.browseSearch = "";
        document.getElementById("browseSearchInput").value = "";
        state.selectedEntityId = btn.dataset.jumpClass;
        renderBrowseControls();
      });
    });
    container.querySelectorAll("[data-jump-teacher]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.browseMode = "teacher";
        state.browseDept = "全部";
        state.browseSearch = "";
        document.getElementById("browseSearchInput").value = "";
        state.selectedEntityId = btn.dataset.jumpTeacher;
        renderBrowseControls();
      });
    });
  }

  // --- Leave & Swap Planner ---
  function initLeaveControls() {
    const term = getTerm();
    if (!term) return;

    const depts = getDepartments(getMergedTeachers(term));
    const deptSel = document.getElementById("leaveDeptFilter");
    deptSel.innerHTML = depts.map((d) => `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join("");
    deptSel.addEventListener("change", renderLeaveTeacherSelect);

    renderLeaveTeacherSelect();

    // Period checkboxes (第1節 ~ 第8節)
    const checksEl = document.getElementById("leavePeriodChecks");
    const selectablePeriods = (term.periods || []).filter((p) => p.key !== "早自習");
    checksEl.innerHTML = selectablePeriods
      .map(
        (p) =>
          `<label class="check-pill"><input type="checkbox" value="${escapeHtml(p.key)}" ${
            ["第1節", "第2節", "第3節", "第4節", "第5節", "第6節", "第7節"].includes(p.key) ? "checked" : ""
          } /> ${escapeHtml(p.label)} (${escapeHtml(p.time)})</label>`
      )
      .join("");

    // Date -> Day auto sync
    const dateInput = document.getElementById("leaveDateInput");
    const daySelect = document.getElementById("leaveDaySelect");
    dateInput.addEventListener("change", () => {
      if (!dateInput.value) return;
      const dt = new Date(dateInput.value + "T00:00:00");
      const dayMap = { 1: "一", 2: "二", 3: "三", 4: "四", 5: "五" };
      const d = dayMap[dt.getDay()];
      if (d) {
        daySelect.value = d;
      } else {
        alert("您選擇的日期為週末（星期六/日），無正常課表，請改選週一至週五。");
      }
    });

    document.getElementById("selectAllPeriodsBtn").addEventListener("click", () => {
      checksEl.querySelectorAll("input").forEach((cb) => {
        cb.checked = cb.value !== "第8節";
      });
    });
    document.getElementById("clearPeriodsBtn").addEventListener("click", () => {
      checksEl.querySelectorAll("input").forEach((cb) => (cb.checked = false));
    });

    document.getElementById("runMatchBtn").addEventListener("click", runSwapAnalysis);
    document.getElementById("emergencyLeaveCheck").addEventListener("change", () => {
      if (state.lastMatches && state.lastMatches.length > 0) {
        renderMatchResults();
        renderPlanSummary();
      }
    });
    document.getElementById("clearPlanBtn").addEventListener("click", () => {
      state.leavePlan = [];
      renderPlanSummary();
      renderMatchResults();
    });
    document.getElementById("copyPlanBtn").addEventListener("click", () => {
      const txt = document.getElementById("planCopyText").value;
      navigator.clipboard?.writeText(txt).then(() => {
        const btn = document.getElementById("copyPlanBtn");
        const old = btn.textContent;
        btn.textContent = "✅ 已複製到剪貼簿！";
        setTimeout(() => (btn.textContent = old), 1800);
      });
    });
  }

  function renderLeaveTeacherSelect() {
    const term = getTerm();
    if (!term) return;
    const dept = document.getElementById("leaveDeptFilter").value || "全部";
    const list = getMergedTeachers(term).filter((t) => dept === "全部" || (t.department || "其他") === dept);
    const sel = document.getElementById("leaveTeacherSelect");
    sel.innerHTML = list
      .map((t) => `<option value="${escapeHtml(t.id)}">${escapeHtml(t.name)}（${escapeHtml(t.department)}｜${t.isCustom ? "本機自訂" : escapeHtml(t.id)}）</option>`)
      .join("");
  }

  function isTeacherFree(term, teacherId, day, periodKey) {
    const t = getMergedTeachers(term).find((x) => x.id === teacherId);
    if (!t) return false;
    return !t.grid?.[periodKey]?.[day];
  }

  function getSelectedLeavePeriods() {
    const cbs = document.querySelectorAll("#leavePeriodChecks input:checked");
    return Array.from(cbs).map((c) => c.value);
  }

  function runSwapAnalysis() {
    const term = getTerm();
    if (!term) return;

    const teacherId = document.getElementById("leaveTeacherSelect").value;
    const leaveDay = document.getElementById("leaveDaySelect").value;
    const allowCrossWeek = document.getElementById("allowCrossWeekCheck").checked;
    const showTri = document.getElementById("showTriSwapCheck").checked;
    const selectedPeriods = getSelectedLeavePeriods();

    const teacher = getMergedTeachers(term).find((t) => t.id === teacherId);
    if (!teacher) return;

    // 找出請假當日有課的節次（排除標記為校外/不克到校的佔位格）
    const leaveClasses = [];
    selectedPeriods.forEach((pKey) => {
      const cell = teacher.grid?.[pKey]?.[leaveDay];
      if (cell && !cell.isUnavailable) {
        leaveClasses.push({
          period: pKey,
          className: cell.className,
          subject: cell.subject,
          isPartTime: cell.isPartTime,
          isSchoolWide: cell.isSchoolWide || isSchoolWide(cell.subject, term),
        });
      }
    });

    if (leaveClasses.length === 0) {
      state.lastMatches = [];
      document.getElementById("leaveResultsContainer").innerHTML = `
        <div class="card"><div class="notice notice-info">
          <strong>${escapeHtml(teacher.name)}</strong> 在 <strong>星期${escapeHtml(leaveDay)}</strong> 所勾選的節次皆為空堂，無需調課！
        </div></div>`;
      return;
    }

    const days = term.days || ["一", "二", "三", "四", "五"];
    const regularPeriods = ["第1節", "第2節", "第3節", "第4節", "第5節", "第6節", "第7節"];

    // 偵測連堂群組（同一班級、同一科目、連續節次）
    const results = leaveClasses.map((lc, idx) => {
      const clsObj = term.classes.find((c) => c.name === lc.className);
      const oneToOne = [];
      const triSwaps = [];
      const substitutes = [];

      if (clsObj && !lc.isSchoolWide) {
        // 計算可代課教師（該請假節次有空堂者，依：1.本科教師 -> 2.同群科教師 -> 3.導師 -> 4.其他空堂）
        const subjDept = inferSubjectDept(lc.subject);
        const classDept = clsObj.department || "";
        const ownDept = teacher.department || "";
        const primaryDepts = new Set([subjDept, classDept, ownDept].filter(Boolean));
        const clusterDepts = new Set();
        primaryDepts.forEach((pd) => {
          (DEPT_CLUSTERS[pd] || []).forEach((cd) => {
            if (!primaryDepts.has(cd)) clusterDepts.add(cd);
          });
        });
        const homeroomId = clsObj.homeroomTeacherId || "";

        term.teachers.forEach((cand) => {
          if (cand.id === teacher.id) return;
          if (!isTeacherFree(term, cand.id, leaveDay, lc.period)) return;

          let tier = 4;
          let tierLabel = "其他空堂";
          if (primaryDepts.has(cand.department)) {
            tier = 1;
            tierLabel = "本科教師";
          } else if (clusterDepts.has(cand.department)) {
            tier = 2;
            tierLabel = "同群科教師";
          } else if (homeroomId && cand.id === homeroomId) {
            tier = 3;
            tierLabel = "該班導師";
          }

          substitutes.push({
            id: `SUB_${lc.period}_${cand.id}`,
            teacherId: cand.id,
            teacherMasked: cand.name,
            department: cand.department || "其他",
            isHomeroom: homeroomId && cand.id === homeroomId,
            tier,
            tierLabel,
          });
        });

        substitutes.sort((a, b) => a.tier - b.tier || a.id.localeCompare(b.id));
        days.forEach((d) => {
          regularPeriods.forEach((pKey) => {
            if (d === leaveDay && !allowCrossWeek) return;
            // 請假教師自己本來在該時段要空堂（且若同一天不同節，跨週時該節也要是空堂）
            if (!isTeacherFree(term, teacher.id, d, pKey)) return;

            const cCell = clsObj.grid?.[pKey]?.[d];
            if (!cCell || !cCell.teacherId || cCell.teacherId === teacher.id) return;
            if (cCell.isSchoolWide || isSchoolWide(cCell.subject, term)) return;

            // 對方教師在請假教師的原節次（leaveDay, lc.period）必須空堂
            if (!isTeacherFree(term, cCell.teacherId, leaveDay, lc.period)) return;

            const isCrossWeekOnly = d === leaveDay;
            oneToOne.push({
              id: `${lc.period}_${d}_${pKey}_${cCell.teacherId}`,
              otherTeacherId: cCell.teacherId,
              otherTeacherMasked: cCell.teacherMasked,
              otherSubject: cCell.subject,
              swapDay: d,
              swapPeriod: pKey,
              isCrossWeekOnly,
              isBlockMatch: false,
            });
          });
        });

        // 檢查是否有同班連堂夥伴（例如前/後一節在請假清單中，同一位老師有連續節次可配對）
        const partnerIdx =
          idx > 0 && leaveClasses[idx - 1].className === lc.className && leaveClasses[idx - 1].subject === lc.subject
            ? idx - 1
            : idx + 1 < leaveClasses.length &&
              leaveClasses[idx + 1].className === lc.className &&
              leaveClasses[idx + 1].subject === lc.subject
            ? idx + 1
            : -1;

        if (partnerIdx !== -1) {
          const partnerPeriod = leaveClasses[partnerIdx].period;
          oneToOne.forEach((opt) => {
            const pIdx = regularPeriods.indexOf(opt.swapPeriod);
            const adjPeriod = idx > partnerIdx ? regularPeriods[pIdx - 1] : regularPeriods[pIdx + 1];
            if (!adjPeriod) return;
            const adjCell = clsObj.grid?.[adjPeriod]?.[opt.swapDay];
            if (
              adjCell &&
              adjCell.teacherId === opt.otherTeacherId &&
              !adjCell.isSchoolWide &&
              isTeacherFree(term, teacher.id, opt.swapDay, adjPeriod) &&
              isTeacherFree(term, opt.otherTeacherId, leaveDay, partnerPeriod)
            ) {
              opt.isBlockMatch = true;
            }
          });
        }

        // 排序：連堂推薦優先 > 當週可調優先 > 星期與節次
        oneToOne.sort((a, b) => {
          if (a.isBlockMatch !== b.isBlockMatch) return a.isBlockMatch ? -1 : 1;
          if (a.isCrossWeekOnly !== b.isCrossWeekOnly) return a.isCrossWeekOnly ? 1 : -1;
          return days.indexOf(a.swapDay) - days.indexOf(b.swapDay) || regularPeriods.indexOf(a.swapPeriod) - regularPeriods.indexOf(b.swapPeriod);
        });

        // 三方連環調（當 showTri 開啟時計算，最多列前 8 組）
        if (showTri) {
          const candidates = [];
          days.forEach((d) => {
            if (d === leaveDay && !allowCrossWeek) return;
            regularPeriods.forEach((pKey) => {
              const cCell = clsObj.grid?.[pKey]?.[d];
              if (!cCell || !cCell.teacherId || cCell.teacherId === teacher.id) return;
              if (cCell.isSchoolWide || isSchoolWide(cCell.subject, term)) return;
              candidates.push({ day: d, period: pKey, teacherId: cCell.teacherId, teacherMasked: cCell.teacherMasked, subject: cCell.subject });
            });
          });

          for (const b of candidates) {
            if (!isTeacherFree(term, b.teacherId, leaveDay, lc.period)) continue;
            for (const c of candidates) {
              if (c.teacherId === b.teacherId) continue;
              if (isTeacherFree(term, c.teacherId, b.day, b.period) && isTeacherFree(term, teacher.id, c.day, c.period)) {
                triSwaps.push({
                  b,
                  c,
                  hasCrossWeek: b.day === leaveDay || c.day === leaveDay,
                });
                if (triSwaps.length >= 8) break;
              }
            }
            if (triSwaps.length >= 8) break;
          }
        }
      }

      return {
        teacher,
        leaveDay,
        leaveClass: lc,
        oneToOne,
        triSwaps,
        substitutes,
      };
    });

    state.lastMatches = results;
    renderMatchResults();
  }

  function isSlotOccupied(day, period, weekOffset = 0) {
    return state.leavePlan.some(
      (p) => p.mode !== "substitute" && p.swapDay === day && p.swapPeriod === period && (p.weekOffset ?? 0) === weekOffset
    );
  }

  function weekOffsetLabel(offset) {
    if (offset === -7) return "前週";
    if (offset === 7) return "後週";
    return "當週";
  }

  function renderMatchResults() {
    const container = document.getElementById("leaveResultsContainer");
    const results = state.lastMatches;
    if (!results || results.length === 0) return;
    const isEmergency = document.getElementById("emergencyLeaveCheck")?.checked || false;

    let html = "";
    results.forEach((res) => {
      const lc = res.leaveClass;
      html += `<div class="slot-result-card">
        <div class="slot-result-header">
          <div>
            <strong>星期${escapeHtml(res.leaveDay)} ${escapeHtml(lc.period)}</strong>
            <span style="margin:0 6px;">｜</span>
            <span style="color:var(--primary);font-weight:700;">${escapeHtml(lc.className)}</span>
            <span style="margin:0 6px;">《${escapeHtml(lc.subject)}》</span>
            ${lc.isPartTime ? '<span class="badge badge-parttime">兼課</span>' : ""}
            ${lc.isSchoolWide ? '<span class="badge badge-schoolwide">共同時間（不可調）</span>' : ""}
          </div>
          <span style="font-size:12px;color:var(--text-muted);">一對一可調：${res.oneToOne.length} 組</span>
        </div>`;

      if (lc.isSchoolWide) {
        html += `<div class="notice notice-warn">此節為全校性共同時間，依規定無法列入調課選項。</div>`;
      } else if (res.oneToOne.length === 0) {
        html += `<div class="notice notice-warn">此節無「一對一直接對調」的教師。${
          res.triSwaps.length > 0 ? "請參考下方三方連環調備案：" : "建議改以代課方式處理，或開啟「允許前後週跨週調課」。"
        }</div>`;
      } else {
        res.oneToOne.forEach((opt) => {
          if (opt.selectedWeekOffset === undefined) {
            opt.selectedWeekOffset = opt.isCrossWeekOnly ? (isEmergency ? 7 : -7) : 0;
          }
          if (isEmergency && opt.selectedWeekOffset === -7) {
            opt.selectedWeekOffset = opt.isCrossWeekOnly ? 7 : 0;
          }
          const planItem = state.leavePlan.find((p) => p.optionId === opt.id);
          if (planItem && isEmergency && planItem.weekOffset === -7) {
            planItem.weekOffset = opt.isCrossWeekOnly ? 7 : 0;
          }
          const isSelected = Boolean(planItem);
          const activeOffset = planItem ? planItem.weekOffset : opt.selectedWeekOffset;
          const conflict = !isSelected && isSlotOccupied(opt.swapDay, opt.swapPeriod, activeOffset);

          html += `<div class="swap-option ${isSelected ? "selected" : ""} ${conflict ? "conflict" : ""}">
            <div>
              <strong>${escapeHtml(opt.otherTeacherMasked)}</strong>
              <span style="margin:0 6px;">｜</span>
              <span>星期${escapeHtml(opt.swapDay)} ${escapeHtml(opt.swapPeriod)}</span>
              <span style="margin:0 6px;">《${escapeHtml(opt.otherSubject)}》</span>
              ${opt.isBlockMatch ? '<span class="badge badge-block">連堂推薦</span>' : ""}
              ${
                opt.isCrossWeekOnly
                  ? `<span class="badge badge-crossweek">${isEmergency ? "僅限後週" : "僅限前後週"}</span>`
                  : '<span class="badge badge-sameweek">當週/前後週皆可</span>'
              }
              ${conflict ? '<span class="badge" style="background:#fee2e2;color:#b91c1c;">同時段已佔用衝突</span>' : ""}
            </div>
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
              <div class="week-picker" data-week-picker="${escapeHtml(opt.id)}">
                <button type="button" data-offset="-7" class="${activeOffset === -7 ? "active" : ""}" ${
            isEmergency ? 'disabled title="臨時請假無法往前週調課"' : ""
          }>前週</button>
                <button type="button" data-offset="0" class="${activeOffset === 0 ? "active" : ""}" ${
            opt.isCrossWeekOnly ? 'disabled title="請假當日無法當週調課"' : ""
          }>當週</button>
                <button type="button" data-offset="7" class="${activeOffset === 7 ? "active" : ""}">後週</button>
              </div>
              <button class="btn btn-sm ${isSelected ? "btn-success" : "btn-primary"}" data-toggle-opt="${escapeHtml(opt.id)}" ${
            conflict ? "disabled" : ""
          }>
                ${isSelected ? "✓ 已加入（點擊取消）" : "＋ 加入規劃"}
              </button>
            </div>
          </div>`;
        });
      }

      if (res.triSwaps.length > 0) {
        html += `<details style="margin-top:10px;" ${res.oneToOne.length === 0 ? "open" : ""}>
          <summary style="cursor:pointer;font-size:13px;font-weight:600;color:var(--purple);">
            🔀 三方連環調（三角調課）備案（共 ${res.triSwaps.length} 組）
          </summary>
          <div style="margin-top:8px;">`;
        res.triSwaps.forEach((tri) => {
          html += `<div class="tri-option">
            請假節次(<strong>${escapeHtml(res.leaveDay)}${escapeHtml(lc.period)}</strong>) ← <strong>${escapeHtml(tri.b.teacherMasked)}</strong> 代上；
            ${escapeHtml(tri.b.teacherMasked)} 的(<strong>${escapeHtml(tri.b.day)}${escapeHtml(tri.b.period)} ${escapeHtml(tri.b.subject)}</strong>) ← <strong>${escapeHtml(tri.c.teacherMasked)}</strong> 代上；
            ${escapeHtml(tri.c.teacherMasked)} 的(<strong>${escapeHtml(tri.c.day)}${escapeHtml(tri.c.period)} ${escapeHtml(tri.c.subject)}</strong>) ← 由您代上
            ${tri.hasCrossWeek ? '<span class="badge badge-crossweek">含前後週</span>' : '<span class="badge badge-sameweek">可同週完成</span>'}
          </div>`;
        });
        html += `</div></details>`;
      }

      if (!lc.isSchoolWide && res.substitutes && res.substitutes.length > 0) {
        const subAutoOpen = res.oneToOne.length === 0 ? "open" : "";
        html += `<details style="margin-top:10px;" ${subAutoOpen}>
          <summary style="cursor:pointer;font-size:13px;font-weight:600;color:var(--warning);">
            🙋 找有空堂教師代課（優先序：本科 → 同群科 → 導師 → 其他空堂，共 ${res.substitutes.length} 位）
          </summary>
          <div style="margin-top:8px;max-height:240px;overflow-y:auto;">`;
        res.substitutes.forEach((sub) => {
          const isSubSelected = state.leavePlan.some((p) => p.optionId === sub.id);
          const tierClass = `badge-sub${sub.tier}`;
          html += `<div class="swap-option ${isSubSelected ? "selected" : ""}">
            <div>
              <span class="badge ${tierClass}">${sub.tier}. ${escapeHtml(sub.tierLabel)}</span>
              <strong style="margin-left:6px;">${escapeHtml(sub.teacherMasked)}</strong>
              <span style="font-size:12px;color:var(--text-muted);margin-left:4px;">（${escapeHtml(sub.department)}${sub.isHomeroom ? "｜本班導師" : ""}）</span>
            </div>
            <button class="btn btn-sm ${isSubSelected ? "btn-success" : ""}" data-toggle-sub="${escapeHtml(sub.id)}">
              ${isSubSelected ? "✓ 已選代課（點擊取消）" : "＋ 選為代課"}
            </button>
          </div>`;
        });
        html += `</div></details>`;
      }

      html += `</div>`;
    });

    container.innerHTML = html;

    // Bind week picker buttons (前週 / 當週 / 後週)
    container.querySelectorAll("[data-week-picker]").forEach((picker) => {
      const optId = picker.dataset.weekPicker;
      picker.querySelectorAll("button[data-offset]").forEach((wBtn) => {
        wBtn.addEventListener("click", () => {
          const newOffset = Number(wBtn.dataset.offset);
          for (const res of state.lastMatches) {
            const found = res.oneToOne.find((o) => o.id === optId);
            if (found) {
              found.selectedWeekOffset = newOffset;
              const planItem = state.leavePlan.find((p) => p.optionId === optId);
              if (planItem) {
                planItem.weekOffset = newOffset;
              }
              break;
            }
          }
          renderMatchResults();
          renderPlanSummary();
        });
      });
    });

    // Bind toggle swap buttons
    container.querySelectorAll("[data-toggle-opt]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const optId = btn.dataset.toggleOpt;
        const existIdx = state.leavePlan.findIndex((p) => p.optionId === optId);
        if (existIdx !== -1) {
          state.leavePlan.splice(existIdx, 1);
        } else {
          for (const res of state.lastMatches) {
            const found = res.oneToOne.find((o) => o.id === optId);
            if (found) {
              state.leavePlan = state.leavePlan.filter((p) => p.leavePeriod !== res.leaveClass.period);
              state.leavePlan.push({
                mode: "swap",
                optionId: found.id,
                teacherName: res.teacher.name,
                leaveDay: res.leaveDay,
                leavePeriod: res.leaveClass.period,
                className: res.leaveClass.className,
                leaveSubject: res.leaveClass.subject,
                otherTeacherMasked: found.otherTeacherMasked,
                otherSubject: found.otherSubject,
                swapDay: found.swapDay,
                swapPeriod: found.swapPeriod,
                isCrossWeekOnly: found.isCrossWeekOnly,
                weekOffset: found.selectedWeekOffset ?? (found.isCrossWeekOnly ? -7 : 0),
              });
              break;
            }
          }
        }
        renderMatchResults();
        renderPlanSummary();
      });
    });

    // Bind toggle substitute buttons
    container.querySelectorAll("[data-toggle-sub]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const subId = btn.dataset.toggleSub;
        const existIdx = state.leavePlan.findIndex((p) => p.optionId === subId);
        if (existIdx !== -1) {
          state.leavePlan.splice(existIdx, 1);
        } else {
          for (const res of state.lastMatches) {
            const found = res.substitutes.find((s) => s.id === subId);
            if (found) {
              state.leavePlan = state.leavePlan.filter((p) => p.leavePeriod !== res.leaveClass.period);
              state.leavePlan.push({
                mode: "substitute",
                optionId: found.id,
                teacherName: res.teacher.name,
                leaveDay: res.leaveDay,
                leavePeriod: res.leaveClass.period,
                className: res.leaveClass.className,
                leaveSubject: res.leaveClass.subject,
                otherTeacherMasked: found.teacherMasked,
                tierLabel: found.tierLabel,
              });
              break;
            }
          }
        }
        renderMatchResults();
        renderPlanSummary();
      });
    });
  }

  function renderPlanSummary() {
    const listEl = document.getElementById("planListContainer");
    const copySec = document.getElementById("planCopySection");
    const copyTxt = document.getElementById("planCopyText");

    if (state.leavePlan.length === 0) {
      listEl.innerHTML = `<p style="font-size:13px;color:var(--text-muted);">尚未加入任何調課安排。在左側點選「加入規劃」後，系統會自動鎖定時段防止撞堂。</p>`;
      copySec.classList.add("hidden");
      return;
    }

    const dateVal = document.getElementById("leaveDateInput").value;
    const datePrefix = dateVal ? `${dateVal} ` : "";

    listEl.innerHTML = state.leavePlan
      .map((p) => {
        if (p.mode === "substitute") {
          return `<div class="plan-item">
            <div><strong>星期${escapeHtml(p.leaveDay)} ${escapeHtml(p.leavePeriod)}</strong>｜${escapeHtml(p.className)}《${escapeHtml(p.leaveSubject)}》</div>
            <div style="color:var(--warning);margin-top:3px;">
              🙋 請 <strong>${escapeHtml(p.otherTeacherMasked)}</strong> 代課（${escapeHtml(p.tierLabel)}）
            </div>
          </div>`;
        }
        return `<div class="plan-item">
          <div><strong>星期${escapeHtml(p.leaveDay)} ${escapeHtml(p.leavePeriod)}</strong>｜${escapeHtml(p.className)}《${escapeHtml(p.leaveSubject)}》</div>
          <div style="color:var(--success);margin-top:3px;">
            ⇄ 與 <strong>${escapeHtml(p.otherTeacherMasked)}</strong> 對調：【${escapeHtml(weekOffsetLabel(p.weekOffset ?? 0))}】星期${escapeHtml(p.swapDay)} ${escapeHtml(p.swapPeriod)}《${escapeHtml(p.otherSubject)}》
          </div>
        </div>`;
      })
      .join("");

    const lines = [
      `【調代課協調清單】申請教師：${state.leavePlan[0].teacherName}${datePrefix ? `｜請假日期：${datePrefix}` : ""}`,
      ...state.leavePlan.map((p, i) => {
        if (p.mode === "substitute") {
          return `${i + 1}. 星期${p.leaveDay} ${p.leavePeriod} ${p.className}《${p.leaveSubject}》 🙋 請 ${p.otherTeacherMasked} 老師代課（${p.tierLabel}）`;
        }
        return `${i + 1}. 星期${p.leaveDay} ${p.leavePeriod} ${p.className}《${p.leaveSubject}》 ⇄ 與 ${p.otherTeacherMasked} 老師「${weekOffsetLabel(p.weekOffset ?? 0)} 星期${p.swapDay} ${p.swapPeriod}《${p.otherSubject}》」對調`;
      }),
    ];
    copyTxt.value = lines.join("\n");
    copySec.classList.remove("hidden");
  }

  // --- Import & Term Management ---
  function validateAndImport(rawJsonText) {
    const msgEl = document.getElementById("importStatusMsg");
    try {
      const data = JSON.parse(rawJsonText);
      if (!data.termId || !Array.isArray(data.teachers) || !Array.isArray(data.classes)) {
        throw new Error("JSON 缺少必要欄位（termId、teachers、classes）。");
      }
      state.terms[data.termId] = data;
      state.currentTermId = data.termId;
      saveTerms();
      renderTopbar();
      renderBrowseControls();
      initLeaveControls();
      renderSavedTerms();
      msgEl.innerHTML = `<span style="color:var(--success);font-weight:600;">✅ 成功匯入「${escapeHtml(
        data.termLabel || data.termId
      )}」（教師 ${data.teachers.length} 位、班級 ${data.classes.length} 班）並已切換為目前使用學年度！</span>`;
    } catch (err) {
      msgEl.innerHTML = `<span style="color:var(--danger);font-weight:600;">❌ 匯入失敗：${escapeHtml(err.message)}</span>`;
    }
  }

  function renderSavedTerms() {
    const el = document.getElementById("savedTermsList");
    const ids = Object.keys(state.terms);
    if (ids.length === 0) {
      el.innerHTML = `<p style="font-size:13px;color:var(--text-muted);">目前無任何已儲存的學年度資料。</p>`;
      return;
    }
    el.innerHTML = ids
      .map((id) => {
        const t = state.terms[id];
        const isCurrent = id === state.currentTermId;
        return `<div class="swap-option ${isCurrent ? "selected" : ""}">
          <div>
            <strong>${escapeHtml(t.termLabel || id)}</strong>（代碼：<code>${escapeHtml(id)}</code>）
            <span style="font-size:12px;color:var(--text-muted);margin-left:8px;">教師 ${t.teachers.length} 位｜班級 ${t.classes.length} 班</span>
          </div>
          <div style="display:flex;gap:6px;">
            ${
              isCurrent
                ? '<span class="badge badge-sameweek">使用中</span>'
                : `<button class="btn btn-sm btn-primary" data-use-term="${escapeHtml(id)}">切換使用</button>`
            }
            <button class="btn btn-sm" data-del-term="${escapeHtml(id)}">刪除</button>
          </div>
        </div>`;
      })
      .join("");

    el.querySelectorAll("[data-use-term]").forEach((b) => {
      b.addEventListener("click", () => {
        state.currentTermId = b.dataset.useTerm;
        state.leavePlan = [];
        renderTopbar();
        renderBrowseControls();
        initLeaveControls();
        renderSavedTerms();
      });
    });
    el.querySelectorAll("[data-del-term]").forEach((b) => {
      b.addEventListener("click", () => {
        const id = b.dataset.delTerm;
        if (Object.keys(state.terms).length <= 1) {
          alert("至少需保留一組學年度資料。");
          return;
        }
        delete state.terms[id];
        if (state.currentTermId === id) {
          state.currentTermId = Object.keys(state.terms)[0];
        }
        saveTerms();
        renderTopbar();
        renderBrowseControls();
        initLeaveControls();
        renderSavedTerms();
      });
    });
  }

  // --- Bootstrap ---
  function init() {
    loadTerms();
    loadCustomTeachers();
    initTabs();
    renderTopbar();

    document.getElementById("termSelect").addEventListener("change", (e) => {
      state.currentTermId = e.target.value;
      state.selectedEntityId = "";
      state.leavePlan = [];
      renderTopbar();
      renderBrowseControls();
      initLeaveControls();
    });

    document.getElementById("modeTeacherBtn").addEventListener("click", () => {
      state.browseMode = "teacher";
      state.browseDept = "全部";
      state.selectedEntityId = "";
      renderBrowseControls();
    });
    document.getElementById("modeClassBtn").addEventListener("click", () => {
      state.browseMode = "class";
      state.browseDept = "全部";
      state.selectedEntityId = "";
      renderBrowseControls();
    });
    document.getElementById("browseSearchInput").addEventListener("input", (e) => {
      state.browseSearch = e.target.value;
      renderBrowseControls();
    });
    document.getElementById("browseDropdown").addEventListener("change", (e) => {
      state.selectedEntityId = e.target.value;
      renderBrowseControls();
    });

    document.getElementById("importJsonFileBtn").addEventListener("click", () => {
      const file = document.getElementById("jsonFileInput").files[0];
      if (!file) {
        alert("請先選擇要匯入的 .json 檔案");
        return;
      }
      const reader = new FileReader();
      reader.onload = (ev) => validateAndImport(ev.target.result);
      reader.readAsText(file, "UTF-8");
    });

    document.getElementById("importJsonPasteBtn").addEventListener("click", () => {
      const txt = document.getElementById("jsonPasteInput").value.trim();
      if (!txt) {
        alert("請先貼上 JSON 內容");
        return;
      }
      validateAndImport(txt);
    });

    renderBrowseControls();
    initLeaveControls();
    initCustomTeacherTab();
    initFormExportModal();
  }

  // --- Custom / Part-Time Teacher Local Timetable ---
  function initCustomTeacherTab() {
    const term = getTerm();
    if (!term) return;

    const deptSel = document.getElementById("customTeacherDept");
    const depts = getDepartments(term.teachers).filter((d) => d !== "全部");
    if (!depts.includes("兼任教師")) depts.unshift("兼任教師");
    deptSel.innerHTML = depts.map((d) => `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join("");

    const classSel = document.getElementById("customCellClass");
    classSel.innerHTML = term.classes
      .map((c) => `<option value="${escapeHtml(c.name)}">${escapeHtml(c.name)}（${escapeHtml(c.department)}）</option>`)
      .join("");

    const cellModal = document.getElementById("customCellModal");
    const closeCellModal = () => cellModal.classList.add("hidden");
    document.getElementById("closeCustomCellModalBtn").addEventListener("click", closeCellModal);
    document.getElementById("cancelCustomCellBtn").addEventListener("click", closeCellModal);

    document.getElementById("customCellType").addEventListener("change", (e) => {
      document.getElementById("customCellClassFields").classList.toggle("hidden", e.target.value !== "class");
    });

    document.getElementById("saveCustomCellBtn").addEventListener("click", () => {
      if (!state.editingCellTarget) return;
      const { day, periodKey } = state.editingCellTarget;
      const type = document.getElementById("customCellType").value;

      if (!state.editingCustomGrid[periodKey]) state.editingCustomGrid[periodKey] = {};
      if (type === "empty") {
        delete state.editingCustomGrid[periodKey][day];
      } else if (type === "unavailable") {
        state.editingCustomGrid[periodKey][day] = {
          subject: "校外/不克調課",
          className: "",
          isPartTime: false,
          isUnavailable: true,
        };
      } else {
        const cls = document.getElementById("customCellClass").value;
        const subj = document.getElementById("customCellSubject").value.trim() || "兼課課程";
        const isPt = document.getElementById("customCellPartTime").checked;
        state.editingCustomGrid[periodKey][day] = {
          subject: subj,
          className: cls,
          isPartTime: isPt,
          isSchoolWide: isSchoolWide(subj, getTerm()),
        };
      }
      closeCellModal();
      renderCustomGridEditor();
    });

    document.getElementById("clearCustomGridBtn").addEventListener("click", () => {
      state.editingCustomGrid = {};
      renderCustomGridEditor();
    });

    document.getElementById("resetCustomFormBtn").addEventListener("click", () => {
      state.editingCustomId = "";
      state.editingCustomGrid = {};
      document.getElementById("customTeacherName").value = "";
      document.getElementById("customSaveMsg").textContent = "";
      renderCustomGridEditor();
    });

    document.getElementById("saveCustomTeacherBtn").addEventListener("click", () => {
      const curTerm = getTerm();
      if (!curTerm) return;
      const name = document.getElementById("customTeacherName").value.trim();
      const dept = document.getElementById("customTeacherDept").value || "兼任教師";
      const msgEl = document.getElementById("customSaveMsg");

      if (!name) {
        msgEl.innerHTML = `<span style="color:var(--danger);">請先輸入教師姓名或稱呼！</span>`;
        return;
      }

      if (!state.customTeachersByTerm[curTerm.termId]) {
        state.customTeachersByTerm[curTerm.termId] = [];
      }
      const list = state.customTeachersByTerm[curTerm.termId];
      const gridCopy = JSON.parse(JSON.stringify(state.editingCustomGrid));

      if (state.editingCustomId) {
        const idx = list.findIndex((t) => t.id === state.editingCustomId);
        if (idx !== -1) {
          list[idx] = { ...list[idx], name, department: dept, grid: gridCopy };
        }
      } else {
        const newId = `CUSTOM_${Date.now()}`;
        list.push({ id: newId, name, department: dept, isCustom: true, grid: gridCopy });
        state.editingCustomId = newId;
      }

      saveCustomTeachers();
      renderBrowseControls();
      renderLeaveTeacherSelect();
      renderCustomTeachersList();
      msgEl.innerHTML = `<span style="color:var(--success);font-weight:600;">✅ 已儲存「${escapeHtml(name)}」至本機！現在可於課表查詢與請假調課中使用。</span>`;
    });

    renderCustomGridEditor();
    renderCustomTeachersList();
  }

  function renderCustomGridEditor() {
    const term = getTerm();
    const container = document.getElementById("customGridEditor");
    if (!term || !container) return;

    const days = term.days || ["一", "二", "三", "四", "五"];
    const periods = (term.periods || []).filter((p) => p.key !== "早自習");

    let html = `<table class="timetable"><thead><tr><th>節次 / 時間</th>`;
    days.forEach((d) => (html += `<th>星期${escapeHtml(d)}</th>`));
    html += `</tr></thead><tbody>`;

    periods.forEach((p) => {
      html += `<tr><td class="period-col">${escapeHtml(p.label)}<span class="period-time">${escapeHtml(p.time)}</span></td>`;
      days.forEach((d) => {
        const cell = state.editingCustomGrid?.[p.key]?.[d];
        let cls = "";
        let inner = `<span style="color:#94a3b8;">＋ 空堂</span>`;
        if (cell?.isUnavailable) {
          cls = "is-unavailable";
          inner = `<span>🚫 不克調課</span>`;
        } else if (cell) {
          cls = "has-class";
          inner = `<strong>${escapeHtml(cell.subject)}</strong><span style="color:var(--primary);">${escapeHtml(cell.className)}</span>`;
        }
        html += `<td><button type="button" class="custom-cell-btn ${cls}" data-edit-day="${escapeHtml(d)}" data-edit-period="${escapeHtml(p.key)}">${inner}</button></td>`;
      });
      html += `</tr>`;
    });

    html += `</tbody></table>`;
    container.innerHTML = html;

    container.querySelectorAll("[data-edit-day]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const day = btn.dataset.editDay;
        const periodKey = btn.dataset.editPeriod;
        state.editingCellTarget = { day, periodKey };

        const existing = state.editingCustomGrid?.[periodKey]?.[day];
        document.getElementById("customCellModalTitle").textContent = `設定：星期${day} ${periodKey}`;
        const typeSel = document.getElementById("customCellType");
        if (!existing) {
          typeSel.value = "class";
          document.getElementById("customCellSubject").value = "";
          document.getElementById("customCellPartTime").checked = true;
        } else if (existing.isUnavailable) {
          typeSel.value = "unavailable";
        } else {
          typeSel.value = "class";
          document.getElementById("customCellClass").value = existing.className || "";
          document.getElementById("customCellSubject").value = existing.subject || "";
          document.getElementById("customCellPartTime").checked = Boolean(existing.isPartTime);
        }
        document.getElementById("customCellClassFields").classList.toggle("hidden", typeSel.value !== "class");
        document.getElementById("customCellModal").classList.remove("hidden");
      });
    });
  }

  function renderCustomTeachersList() {
    const term = getTerm();
    const el = document.getElementById("customTeachersList");
    if (!term || !el) return;
    const list = state.customTeachersByTerm[term.termId] || [];
    if (list.length === 0) {
      el.innerHTML = `<p style="font-size:13px;color:var(--text-muted);">目前尚未建立任何本機自訂教師。</p>`;
      return;
    }

    el.innerHTML = list
      .map((t) => {
        let count = 0;
        Object.values(t.grid || {}).forEach((row) => {
          Object.values(row || {}).forEach((c) => {
            if (c && !c.isUnavailable) count++;
          });
        });
        return `<div class="swap-option">
          <div>
            <strong>${escapeHtml(t.name)}</strong>
            <span class="badge badge-parttime" style="margin-left:6px;">${escapeHtml(t.department)}</span>
            <span style="font-size:12px;color:var(--text-muted);margin-left:8px;">已排授課 ${count} 節</span>
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;">
            <button class="btn btn-sm btn-primary" data-custom-leave="${escapeHtml(t.id)}">🔄 請假調課規劃</button>
            <button class="btn btn-sm" data-custom-edit="${escapeHtml(t.id)}">編輯</button>
            <button class="btn btn-sm" data-custom-del="${escapeHtml(t.id)}">刪除</button>
          </div>
        </div>`;
      })
      .join("");

    el.querySelectorAll("[data-custom-leave]").forEach((b) => {
      b.addEventListener("click", () => {
        document.getElementById("leaveDeptFilter").value = "全部";
        renderLeaveTeacherSelect();
        document.getElementById("leaveTeacherSelect").value = b.dataset.customLeave;
        switchTab("leave");
      });
    });
    el.querySelectorAll("[data-custom-edit]").forEach((b) => {
      b.addEventListener("click", () => {
        const found = list.find((x) => x.id === b.dataset.customEdit);
        if (!found) return;
        state.editingCustomId = found.id;
        state.editingCustomGrid = JSON.parse(JSON.stringify(found.grid || {}));
        document.getElementById("customTeacherName").value = found.name;
        document.getElementById("customTeacherDept").value = found.department || "兼任教師";
        document.getElementById("customSaveMsg").textContent = "";
        renderCustomGridEditor();
      });
    });
    el.querySelectorAll("[data-custom-del]").forEach((b) => {
      b.addEventListener("click", () => {
        const id = b.dataset.customDel;
        state.customTeachersByTerm[term.termId] = list.filter((x) => x.id !== id);
        if (state.editingCustomId === id) {
          state.editingCustomId = "";
          state.editingCustomGrid = {};
          renderCustomGridEditor();
        }
        saveCustomTeachers();
        renderBrowseControls();
        renderLeaveTeacherSelect();
        renderCustomTeachersList();
      });
    });
  }

  // --- Official Leave/Swap Form Export (Print/PDF/Word) ---
  function initFormExportModal() {
    const modal = document.getElementById("formModal");
    const closeModal = () => modal.classList.add("hidden");

    document.getElementById("openFormModalBtn").addEventListener("click", () => {
      if (state.leavePlan.length === 0) return;
      document.getElementById("formTeacherNameInput").value = "";
      renderFormPreview();
      modal.classList.remove("hidden");
    });

    document.getElementById("closeFormModalBtn").addEventListener("click", closeModal);
    document.getElementById("closeFormModalBtn2").addEventListener("click", closeModal);

    ["formTeacherNameInput", "formLeaveTypeSelect", "formCustomLeaveTypeInput", "formReasonInput"].forEach((id) => {
      document.getElementById(id).addEventListener("input", () => {
        if (id === "formCustomLeaveTypeInput" && document.getElementById(id).value.trim()) {
          document.getElementById("formLeaveTypeSelect").value = "其他";
        }
        renderFormPreview();
      });
      document.getElementById(id).addEventListener("change", renderFormPreview);
    });

    document.getElementById("printPdfBtn").addEventListener("click", () => {
      const sheetsHtml = buildFormSheetsHtml();
      document.getElementById("printArea").innerHTML = sheetsHtml;
      window.print();
    });

    document.getElementById("downloadWordBtn").addEventListener("click", () => {
      downloadWordDoc();
    });
  }

  function parseTermYearSem() {
    const term = getTerm();
    const id = term?.termId || "115-1";
    const parts = id.split("-");
    return {
      acadYear: parts[0] || "115",
      sem: parts[1] || "1",
    };
  }

  function getDayIndex(dayChar) {
    return { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5 }[dayChar] || 1;
  }

  function formatPeriodNum(periodKey) {
    return String(periodKey || "").replace("第", "").replace("節", "").trim();
  }

  function computeDatesForPlanItem(item, baseDateStr) {
    if (!baseDateStr) {
      return {
        rocYear: parseTermYearSem().acadYear,
        leaveMonth: "",
        leaveDayNum: "",
        swapMonth: "",
        swapDayNum: "",
      };
    }
    const baseDt = new Date(baseDateStr + "T00:00:00");
    const rocYear = String(baseDt.getFullYear() - 1911);
    const leaveMonth = String(baseDt.getMonth() + 1);
    const leaveDayNum = String(baseDt.getDate());

    const baseDow = baseDt.getDay() === 0 ? 7 : baseDt.getDay();
    const targetDow = getDayIndex(item.swapDay);
    const diff = targetDow - baseDow + Number(item.weekOffset ?? 0);
    const swapDt = new Date(baseDt);
    swapDt.setDate(baseDt.getDate() + diff);

    return {
      rocYear,
      leaveMonth,
      leaveDayNum,
      swapMonth: String(swapDt.getMonth() + 1),
      swapDayNum: String(swapDt.getDate()),
    };
  }

  function fitFontSize(text, thresholds) {
    const len = String(text || "").length;
    for (const [maxLen, pt] of thresholds) {
      if (len <= maxLen) return `font-size:${pt}pt;line-height:1.15;`;
    }
    return `font-size:${thresholds[thresholds.length - 1][1]}pt;line-height:1.1;`;
  }

  function buildFormSheetsHtml() {
    const { acadYear, sem } = parseTermYearSem();
    const teacherName = document.getElementById("formTeacherNameInput").value.trim();
    const leaveType = document.getElementById("formLeaveTypeSelect").value;
    const customLeaveType = document.getElementById("formCustomLeaveTypeInput").value.trim();
    const reason = document.getElementById("formReasonInput").value.trim();
    const baseDateStr = document.getElementById("leaveDateInput").value;

    const effectiveLeaveType = customLeaveType ? "其他" : leaveType;
    const ck = (val) => (effectiveLeaveType === val ? "☑" : "□");
    const otherTxt = customLeaveType || (effectiveLeaveType === "其他" && reason ? reason : "_____");
    const leaveTypesLine1 = `${ck("公")}公(請填寫事由) ${ck("事")}事 ${ck("其他")}其他(${escapeHtml(otherTxt)})`;
    const leaveTypesLine2 = `${ck("喪")}喪 ${ck("病3+")}病(3日以上) ${ck("病3-")}病(未達3日)`;

    const nameStyle = fitFontSize(teacherName, [[4, 12], [6, 10], [10, 8.5], [999, 7.5]]);
    const reasonStyle = fitFontSize(reason, [[14, 10.5], [26, 9], [42, 8], [999, 7]]);
    const subjThresholds = [[4, 11], [6, 9.5], [9, 8], [999, 7]];
    const clsThresholds = [[4, 11], [6, 9.5], [999, 8]];

    // 依節次排序，每張表最多 6 列
    const sorted = [...state.leavePlan].sort(
      (a, b) => Number(formatPeriodNum(a.leavePeriod)) - Number(formatPeriodNum(b.leavePeriod))
    );
    const pages = [];
    for (let i = 0; i < sorted.length; i += 6) {
      pages.push(sorted.slice(i, i + 6));
    }
    if (pages.length === 0) pages.push([]);

    // 精準對應原廠 .doc 17 欄寬度（單位 mm，總寬 257.3mm）
    const colWidthsMm = [9.9, 9.9, 5.1, 4.9, 19.5, 9.0, 9.3, 17.1, 9.0, 9.0, 19.5, 8.6, 28.9, 12.8, 17.5, 12.5, 54.7];
    const colgroupHtml = `<colgroup>${colWidthsMm.map((w) => `<col style="width:${w}mm;" />`).join("")}</colgroup>`;

    return pages
      .map((rows) => {
        let rowsHtml = "";
        for (let r = 0; r < 6; r++) {
          const item = rows[r];
          if (!item) {
            rowsHtml += `<tr class="data-row">
              <td></td><td></td><td colspan="2"></td><td></td><td></td><td colspan="2"></td>
              <td></td><td></td><td></td><td></td><td></td><td colspan="3" class="sig-cell"></td><td class="sig-cell"></td>
            </tr>`;
          } else if (item.mode === "substitute") {
            const dt = computeDatesForPlanItem(item, baseDateStr);
            rowsHtml += `<tr class="data-row">
              <td>${escapeHtml(dt.rocYear)}</td>
              <td>${escapeHtml(dt.leaveMonth)}</td>
              <td colspan="2">${escapeHtml(dt.leaveDayNum)}</td>
              <td style="${fitFontSize(item.className, clsThresholds)}">${escapeHtml(item.className)}</td>
              <td>${escapeHtml(formatPeriodNum(item.leavePeriod))}</td>
              <td colspan="2" style="${fitFontSize(item.leaveSubject, subjThresholds)}">${escapeHtml(item.leaveSubject)}</td>
              <td></td><td></td><td></td><td></td><td></td><td colspan="3" class="sig-cell"></td>
              <td class="sig-cell"><span class="sig-hint">${escapeHtml(item.otherTeacherMasked)}</span></td>
            </tr>`;
          } else {
            const dt = computeDatesForPlanItem(item, baseDateStr);
            rowsHtml += `<tr class="data-row">
              <td>${escapeHtml(dt.rocYear)}</td>
              <td>${escapeHtml(dt.leaveMonth)}</td>
              <td colspan="2">${escapeHtml(dt.leaveDayNum)}</td>
              <td style="${fitFontSize(item.className, clsThresholds)}">${escapeHtml(item.className)}</td>
              <td>${escapeHtml(formatPeriodNum(item.leavePeriod))}</td>
              <td colspan="2" style="${fitFontSize(item.leaveSubject, subjThresholds)}">${escapeHtml(item.leaveSubject)}</td>
              <td>${escapeHtml(dt.swapMonth)}</td>
              <td>${escapeHtml(dt.swapDayNum)}</td>
              <td style="${fitFontSize(item.className, clsThresholds)}">${escapeHtml(item.className)}</td>
              <td>${escapeHtml(formatPeriodNum(item.swapPeriod))}</td>
              <td style="${fitFontSize(item.otherSubject, subjThresholds)}">${escapeHtml(item.otherSubject)}</td>
              <td colspan="3" class="sig-cell"><span class="sig-hint">${escapeHtml(item.otherTeacherMasked)}</span></td>
              <td class="sig-cell"></td>
            </tr>`;
          }
        }

        return `<div class="leave-form-sheet">
          <div class="leave-form-title">國立臺東專科學校附設高職部　${escapeHtml(acadYear)}　學年度第　${escapeHtml(sem)}　學期調代課單</div>
          <table class="leave-form-table">
            ${colgroupHtml}
            <tr class="row-r0">
              <th colspan="3">教師<br/>姓名</th>
              <td colspan="4" style="${nameStyle}">${escapeHtml(teacherName)}</td>
              <th>假別</th>
              <td colspan="6" style="text-align:left;padding-left:6px;${fitFontSize(otherTxt, [[8, 9.5], [14, 8.5], [999, 7.5]])}">
                ${leaveTypesLine1}<br/>${leaveTypesLine2}
              </td>
              <th>公假<br/>事由</th>
              <td colspan="2" style="text-align:left;vertical-align:top;padding:3px 5px;">
                <div style="min-height:20px;${reasonStyle}">${escapeHtml(reason)}</div>
                <div style="font-size:7pt;color:#475569;text-align:right;line-height:1.1;">公假由學校或計畫支付鐘點費者，請檢附公文</div>
              </td>
            </tr>
            <tr class="row-r1">
              <th colspan="8">請　假　時　間</th>
              <th colspan="8">調　　　　課</th>
              <th>代　課</th>
            </tr>
            <tr class="row-r2">
              <th>年</th><th>月</th><th colspan="2">日</th><th>班級</th><th>節<br/>次</th><th colspan="2">科目</th>
              <th>月</th><th>日</th><th>班級</th><th>節<br/>次</th><th>科目</th><th colspan="3">調課教師</th>
              <th>代課教師</th>
            </tr>
            ${rowsHtml}
            <tr class="row-r9">
              <td colspan="17" style="text-align:left;padding:6px 12px;">
                教學組：　　　　　　　　　　　　　　　高職部主任：
              </td>
            </tr>
          </table>
          <div class="leave-form-footer">**公假由學校或計畫支付鐘點費者，請檢附公文</div>
        </div>`;
      })
      .join("");
  }

  function renderFormPreview() {
    document.getElementById("formPreviewContainer").innerHTML = buildFormSheetsHtml();
  }

  function downloadWordDoc() {
    const sheetsHtml = buildFormSheetsHtml();
    const wordHtml = `<html xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:w="urn:schemas-microsoft-com:office:word"
      xmlns="http://www.w3.org/TR/REC-html40">
      <head>
        <meta charset="utf-8" />
        <title>調代課單</title>
        <style>
          @page WordSection1 {
            size: 29.7cm 21.0cm;
            mso-page-orientation: landscape;
            margin: 1.0cm 2.0cm 1.0cm 2.0cm;
          }
          div.WordSection1 { page: WordSection1; }
          body { font-family: "DFKai-SB", "標楷體", serif; color: #000; }
          .leave-form-sheet { page-break-after: always; margin-bottom: 12px; }
          .leave-form-sheet:last-child { page-break-after: auto; }
          .leave-form-title { text-align: center; font-size: 18pt; font-weight: bold; margin-bottom: 6px; }
          .leave-form-table { width: 25.7cm; border-collapse: collapse; border: 1.5pt solid #000; table-layout: fixed; font-size: 11pt; }
          .leave-form-table th, .leave-form-table td { border: 0.75pt solid #000; padding: 2pt 3pt; text-align: center; vertical-align: middle; }
          .leave-form-table tr.row-r0 { height: 1.4cm; }
          .leave-form-table tr.row-r1 { height: 1.68cm; }
          .leave-form-table tr.row-r2 { height: 1.4cm; }
          .leave-form-table tr.data-row { height: 1.49cm; }
          .leave-form-table tr.row-r9 { height: 1.4cm; }
          .leave-form-table td.sig-cell { text-align: right; vertical-align: bottom; padding: 2pt 4pt; }
          .sig-hint { font-size: 8.5pt; color: #94a3b8; }
          .leave-form-footer { text-align: right; font-size: 10pt; margin-top: 4pt; width: 25.7cm; }
        </style>
      </head>
      <body><div class="WordSection1">${sheetsHtml}</div></body>
    </html>`;

    const blob = new Blob(["\ufeff", wordHtml], { type: "application/msword;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const dateStr = document.getElementById("leaveDateInput").value || "調代課單";
    a.href = url;
    a.download = `高職部調代課單_${dateStr}.doc`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  document.addEventListener("DOMContentLoaded", init);
})();
