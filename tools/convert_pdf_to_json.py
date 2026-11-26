#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
本機課表 PDF 轉檔與去個資工具
在個人電腦離線執行，讀取「班級課表 PDF」與「教師課表 PDF」，
自動將教師姓名遮罩去個資（中間字改為 ○），輸出可供網頁系統使用的 JSON 與預設資料檔。
"""

import argparse
import json
import os
import re
import sys
from pathlib import Path

try:
    import fitz  # PyMuPDF
    import pdfplumber
except ImportError:
    print("缺少必要套件，請先執行: pip install pymupdf pdfplumber")
    sys.exit(1)

DAYS = ["一", "二", "三", "四", "五"]
PERIODS = [
    {"key": "早自習", "label": "早自習", "time": ""},
    {"key": "第1節", "label": "第 1 節", "time": "08:10-09:00"},
    {"key": "第2節", "label": "第 2 節", "time": "09:10-10:00"},
    {"key": "第3節", "label": "第 3 節", "time": "10:10-11:00"},
    {"key": "第4節", "label": "第 4 節", "time": "11:10-12:00"},
    {"key": "第5節", "label": "第 5 節", "time": "13:10-14:00"},
    {"key": "第6節", "label": "第 6 節", "time": "14:10-15:00"},
    {"key": "第7節", "label": "第 7 節", "time": "15:20-16:10"},
    {"key": "第8節", "label": "第 8 節", "time": "16:20-17:10"},
]

SCHOOL_WIDE_KEYWORDS = ["班會", "週會", "團體活動", "彈性教學", "彈性學習時間"]

CLASS_DEPT_MAP = {
    "畜保": "畜保科",
    "農機": "農機科",
    "家政": "家政科",
    "機械": "機械科",
    "汽車": "汽車科",
    "電機": "電機科",
    "資訊": "資訊科",
    "土木": "土木科",
    "室設": "室設科",
    "綜職": "綜合職能科",
}


def mask_name(name: str) -> str:
    """將姓名中間字改為 ○，2 字姓名則將第 2 字改為 ○。"""
    name = (name or "").strip()
    if not name:
        return ""
    if len(name) == 1:
        return "○"
    if len(name) == 2:
        return name[0] + "○"
    return name[0] + ("○" * (len(name) - 2)) + name[-1]


def clean_cell(s: str) -> str:
    if not s:
        return ""
    return " / ".join([line.strip() for line in s.splitlines() if line.strip()])


def is_school_wide_subject(subject: str) -> bool:
    return any(kw in subject for kw in SCHOOL_WIDE_KEYWORDS)


def parse_teacher_directory(page_text: str) -> dict:
    """從教師課表第 2 頁（師資表）解析教師姓名與科別對照。"""
    lines = [l.strip() for l in page_text.splitlines() if l.strip()]
    dept_keywords = (
        "科", "美術", "體育", "輔導教師", "軍訓", "兼任教師", "代理", "代課"
    )
    name_to_dept = {}
    current_dept = "其他"
    for line in lines:
        if line in ("正式58", "代課1", "代理10", "兼任15") or re.match(r"^(正式|代課|代理|兼任)\d+$", line):
            continue
        if "師資表" in line:
            continue
        if line.isdigit():
            continue
        if line.endswith("科") or line in ("美術", "體育", "輔導教師", "軍訓", "兼任教師"):
            current_dept = line
        else:
            # 可能是教師姓名
            if 2 <= len(line) <= 5:
                name_to_dept[line] = current_dept
    return name_to_dept


def parse_teacher_cell(raw_cell: str) -> dict | None:
    """解析教師課表中的單一儲存格，回傳 subject, className, isPartTime。"""
    if not raw_cell:
        return None
    lines = [l.strip() for l in raw_cell.splitlines() if l.strip()]
    if not lines:
        return None

    is_part_time = False
    if lines[0] == "兼":
        is_part_time = True
        lines = lines[1:]

    if not lines:
        return None

    # 通常最後一行是班級名稱（例如：汽車二、綜職一），前面是科目名稱（可能跨兩行）
    if len(lines) >= 2:
        class_name = lines[-1]
        subject = "".join(lines[:-1])
    else:
        class_name = ""
        subject = lines[0]

    return {
        "subject": subject,
        "className": class_name,
        "isPartTime": is_part_time,
        "isSchoolWide": is_school_wide_subject(subject),
    }


def parse_class_cell(raw_cell: str, name_to_id: dict, name_to_masked: dict) -> dict | None:
    """解析班級課表中的單一儲存格，支援單一教師與雙師協同教學。"""
    if not raw_cell:
        return None
    lines = [l.strip() for l in raw_cell.splitlines() if l.strip()]
    if not lines:
        return None

    last = lines[-1]
    tokens = last.split()
    # 檢查最後一行是否為 1 位或多位教師姓名（例如「王大明 陳小華」）
    all_teachers = len(tokens) >= 1 and all(
        (tok in name_to_id or (len(lines) >= 2 and 2 <= len(tok) <= 4 and tok not in ("彈性教學", "團體活動", "彈性學習時間")))
        for tok in tokens
    )

    if all_teachers and not any(kw in last for kw in SCHOOL_WIDE_KEYWORDS):
        subject = "".join(lines[:-1]) if len(lines) > 1 else last
        if subject == last:
            return {
                "subject": subject,
                "teacherId": "",
                "teacherMasked": "",
                "isSchoolWide": is_school_wide_subject(subject),
            }
        t_ids = [name_to_id.get(tok, "") for tok in tokens]
        t_masks = [name_to_masked.get(tok, mask_name(tok)) for tok in tokens]
        return {
            "subject": subject,
            "teacherId": t_ids[0] if len(t_ids) == 1 else ",".join(t_ids),
            "teacherIds": [x for x in t_ids if x],
            "teacherMasked": "、".join(t_masks),
            "isSchoolWide": is_school_wide_subject(subject),
        }
    else:
        subject = "".join(lines)
        return {
            "subject": subject,
            "teacherId": "",
            "teacherMasked": "",
            "isSchoolWide": is_school_wide_subject(subject),
        }


def infer_class_dept(class_name: str) -> str:
    for prefix, dept in CLASS_DEPT_MAP.items():
        if class_name.startswith(prefix):
            return dept
    return "其他"


def sanitize_string(s: str, name_to_masked: dict) -> str:
    """確保字串中不殘留任何真實教師姓名（包含因換行產生的空白拆字）。"""
    if not s:
        return s
    out = s
    # 依姓名長度由長到短取代，避免短名誤傷長名
    for real_name in sorted(name_to_masked.keys(), key=len, reverse=True):
        if len(real_name) < 2:
            continue
        masked = name_to_masked[real_name]
        pattern = r"\s*".join(re.escape(ch) for ch in real_name)
        out = re.sub(pattern, masked, out)
    return out


def sanitize_result(obj, name_to_masked: dict):
    if isinstance(obj, dict):
        return {k: sanitize_result(v, name_to_masked) for k, v in obj.items()}
    if isinstance(obj, list):
        return [sanitize_result(v, name_to_masked) for v in obj]
    if isinstance(obj, str):
        return sanitize_string(obj, name_to_masked)
    return obj


def convert_pdfs(teacher_pdf: str, class_pdf: str, term_id: str, term_label: str) -> dict:
    print(f"[1/4] 讀取教師課表索引: {teacher_pdf}")
    doc_t = fitz.open(teacher_pdf)

    # 嘗試從第 2 頁取得科別對照
    name_to_dept = {}
    if len(doc_t) > 1:
        name_to_dept = parse_teacher_directory(doc_t[1].get_text())

    # 第一輪掃描教師頁：取得頁碼、編號與真實姓名（僅於本機記憶體建立映射）
    teacher_meta = []
    name_to_id = {}
    name_to_masked = {}

    for i, page in enumerate(doc_t):
        txt = page.get_text()
        m_id = re.search(r"編號:\s*(\d+)", txt)
        if not m_id:
            continue
        tid = m_id.group(1).zfill(3)

        # 尋找教師姓名（通常在「編號:」前一行或同一行）
        lines = [l.strip() for l in txt.splitlines() if l.strip()]
        tname = ""
        for idx_l, l in enumerate(lines):
            if "編號:" in l:
                m_same = re.match(r"^(.+?)\s+編號:", l)
                if m_same and m_same.group(1) not in ("國立臺東專科學校高職部", "教師："):
                    tname = m_same.group(1).strip()
                elif idx_l > 0:
                    cand = lines[idx_l - 1].replace("教師：", "").strip()
                    if cand and cand != "國立臺東專科學校高職部":
                        tname = cand
                break

        if not tname:
            continue

        masked = mask_name(tname)
        dept = name_to_dept.get(tname, "其他")
        name_to_id[tname] = tid
        name_to_masked[tname] = masked
        teacher_meta.append({
            "page_idx": i,
            "id": tid,
            "real_name": tname,
            "masked_name": masked,
            "department": dept,
        })

    print(f"[2/4] 解析 {len(teacher_meta)} 位教師課表...")
    teachers_out = []
    with pdfplumber.open(teacher_pdf) as pdf_t:
        for meta in teacher_meta:
            page = pdf_t.pages[meta["page_idx"]]
            tables = page.extract_tables()
            if not tables:
                continue
            t = tables[0]
            grid = {}
            for r_idx, pinfo in enumerate(PERIODS):
                row_idx = r_idx + 1
                if row_idx >= len(t):
                    break
                row = t[row_idx]
                p_key = pinfo["key"]
                grid[p_key] = {}
                for d_idx, d_key in enumerate(DAYS):
                    raw = row[3 + d_idx] if (3 + d_idx) < len(row) else ""
                    parsed = parse_teacher_cell(raw)
                    if parsed:
                        grid[p_key][d_key] = parsed

            teachers_out.append({
                "id": meta["id"],
                "name": meta["masked_name"],
                "department": meta["department"],
                "grid": grid,
            })

    print(f"[3/4] 解析班級課表: {class_pdf}")
    doc_c = fitz.open(class_pdf)
    class_meta = []
    for i, page in enumerate(doc_c):
        txt = page.get_text()
        if "班級：" not in txt:
            continue
        lines = [l.strip() for l in txt.splitlines() if l.strip()]
        if len(lines) < 3 or "國立臺東專科學校" in lines[0]:
            continue
        cname = lines[0]
        # lines[1] 通常是班級代碼（如 1021），lines[2] 是導師姓名
        homeroom = lines[2] if lines[2] != "國立臺東專科學校高職部" else ""
        class_meta.append({
            "page_idx": i,
            "name": cname,
            "department": infer_class_dept(cname),
            "homeroom_masked": name_to_masked.get(homeroom, mask_name(homeroom)),
            "homeroom_id": name_to_id.get(homeroom, ""),
        })

    classes_out = []
    with pdfplumber.open(class_pdf) as pdf_c:
        for meta in class_meta:
            page = pdf_c.pages[meta["page_idx"]]
            tables = page.extract_tables()
            if not tables:
                continue
            t = tables[0]
            grid = {}
            for r_idx, pinfo in enumerate(PERIODS):
                row_idx = r_idx + 1
                if row_idx >= len(t):
                    break
                row = t[row_idx]
                p_key = pinfo["key"]
                grid[p_key] = {}
                for d_idx, d_key in enumerate(DAYS):
                    raw = row[3 + d_idx] if (3 + d_idx) < len(row) else ""
                    parsed = parse_class_cell(raw, name_to_id, name_to_masked)
                    if parsed:
                        grid[p_key][d_key] = parsed

            classes_out.append({
                "name": meta["name"],
                "department": meta["department"],
                "homeroomTeacher": meta["homeroom_masked"],
                "homeroomTeacherId": meta["homeroom_id"],
                "grid": grid,
            })

    # 安全檢查與最終去個資淨化：確認輸出 JSON 中不含任何真實全名
    result = sanitize_result({
        "schemaVersion": 1,
        "termId": term_id,
        "termLabel": term_label,
        "days": DAYS,
        "periods": PERIODS,
        "schoolWideKeywords": SCHOOL_WIDE_KEYWORDS,
        "teachers": teachers_out,
        "classes": classes_out,
    }, name_to_masked)

    serialized = json.dumps(result, ensure_ascii=False)
    leaked = [rn for rn in name_to_id.keys() if len(rn) >= 2 and rn in serialized]
    if leaked:
        print(f"[警告] 偵測到可能有未遮罩姓名殘留: {leaked}")
    else:
        print("[4/4] 去個資安全檢查通過：輸出檔不含任何教師真實全名！")

    return result


def main():
    parser = argparse.ArgumentParser(description="本機課表 PDF 轉去個資 JSON 工具")
    parser.add_argument("--teacher-pdf", required=True, help="教師課表 PDF 路徑")
    parser.add_argument("--class-pdf", required=True, help="班級課表 PDF 路徑")
    parser.add_argument("--term-id", default="115-1", help="學年度學期代碼 (例如 115-1)")
    parser.add_argument("--term-label", default="115 學年度第 1 學期", help="顯示名稱")
    parser.add_argument("--out-json", required=True, help="輸出 JSON 檔案路徑")
    parser.add_argument("--out-bundle-js", default="", help="選填：同時更新預設內嵌 JS 檔")
    args = parser.parse_args()

    data = convert_pdfs(args.teacher_pdf, args.class_pdf, args.term_id, args.term_label)

    out_path = Path(args.out_json)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"已寫入 JSON: {out_path}（教師 {len(data['teachers'])} 位、班級 {len(data['classes'])} 班）")

    if args.out_bundle_js:
        js_path = Path(args.out_bundle_js)
        js_path.parent.mkdir(parents=True, exist_ok=True)
        js_content = (
            "// 本檔案由本機去個資轉檔工具自動產生，不含任何教師真實全名\n"
            f"window.__DEFAULT_TIMETABLE_TERM__ = {json.dumps(data, ensure_ascii=False)};\n"
        )
        js_path.write_text(js_content, encoding="utf-8")
        print(f"已寫入預設資料 JS: {js_path}")


if __name__ == "__main__":
    main()
