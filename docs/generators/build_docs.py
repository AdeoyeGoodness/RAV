#!/usr/bin/env python3
"""Generate the three RAV customer-facing deliverables.

Outputs (into ../ relative to this script, i.e. the repo `docs/` folder):
  1. RAV_User_Manual.docx   -- reference manual (what each screen/feature is)
  2. RAV_How_To_Guide.docx  -- task walkthroughs (step-by-step)
  3. RAV_Business_Case.pptx -- external stakeholder pitch (problem -> solution -> case)

Re-run any time the product changes:  python docs/generators/build_docs.py
Requires: python-docx, python-pptx  (pip install python-docx python-pptx)
"""

import os
from docx import Document
from docx.shared import Pt, RGBColor, Inches
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

from pptx import Presentation
from pptx.util import Inches as PInches, Pt as PPt, Emu
from pptx.dml.color import RGBColor as PColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR

# ---------------------------------------------------------------------------
# Shared palette / brand
# ---------------------------------------------------------------------------
INK      = RGBColor(0x14, 0x18, 0x1F)   # near-black headings
INK2     = RGBColor(0x3A, 0x42, 0x4E)   # body-ish slate
MUTE     = RGBColor(0x6B, 0x74, 0x82)   # captions
ACCENT   = RGBColor(0xC2, 0x6B, 0x1E)   # amber / burnt-orange
RULE     = RGBColor(0xD9, 0xDD, 0xE3)   # hairline
BANDBG   = RGBColor(0xF4, 0xF1, 0xEC)   # warm panel

# PPTX palette (dark deck)
P_BG     = PColor(0x0E, 0x11, 0x16)
P_PANEL  = PColor(0x16, 0x1B, 0x22)
P_INK    = PColor(0xF2, 0xF3, 0xF5)
P_MUTE   = PColor(0x9A, 0xA3, 0xAF)
P_ACCENT = PColor(0xE0, 0xA8, 0x3B)
P_LINE   = PColor(0x2A, 0x31, 0x3C)
P_CRIT   = PColor(0xD8, 0x5B, 0x4A)

HERE = os.path.dirname(os.path.abspath(__file__))
OUT  = os.path.abspath(os.path.join(HERE, ".."))

PRODUCT   = "RAV / Systems"
TAGLINE   = "Endpoint Intelligence & Insider-Threat Monitoring"
VERSION   = "Document rev. 1.0"

# ===========================================================================
# DOCX helpers
# ===========================================================================
def _set_cell_bg(cell, hexcolor):
    tcPr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement('w:shd')
    shd.set(qn('w:val'), 'clear')
    shd.set(qn('w:color'), 'auto')
    shd.set(qn('w:fill'), hexcolor)
    tcPr.append(shd)

def _no_table_borders(table):
    tbl = table._tbl
    tblPr = tbl.tblPr
    borders = OxmlElement('w:tblBorders')
    for edge in ('top', 'left', 'bottom', 'right', 'insideH', 'insideV'):
        el = OxmlElement(f'w:{edge}')
        el.set(qn('w:val'), 'single')
        el.set(qn('w:sz'), '4')
        el.set(qn('w:space'), '0')
        el.set(qn('w:color'), 'E4E7EC')
        borders.append(el)
    tblPr.append(borders)

def base_styles(doc):
    normal = doc.styles['Normal']
    normal.font.name = 'Calibri'
    normal.font.size = Pt(10.5)
    normal.font.color.rgb = INK2
    pf = normal.paragraph_format
    pf.space_after = Pt(6)
    pf.line_spacing = 1.18

def add_eyebrow(doc, text):
    p = doc.add_paragraph()
    r = p.add_run(text.upper())
    r.font.size = Pt(8)
    r.font.bold = True
    r.font.color.rgb = ACCENT
    r.font.name = 'Consolas'
    pf = p.paragraph_format
    pf.space_after = Pt(2)
    # letter spacing
    rPr = r._element.get_or_add_rPr()
    spc = OxmlElement('w:spacing'); spc.set(qn('w:val'), '40'); rPr.append(spc)
    return p

def add_h1(doc, text):
    p = doc.add_paragraph()
    r = p.add_run(text)
    r.font.size = Pt(17)
    r.font.bold = True
    r.font.color.rgb = INK
    p.paragraph_format.space_before = Pt(14)
    p.paragraph_format.space_after = Pt(4)
    # accent underline via bottom border
    pPr = p._p.get_or_add_pPr()
    pbdr = OxmlElement('w:pBdr')
    bottom = OxmlElement('w:bottom')
    bottom.set(qn('w:val'), 'single'); bottom.set(qn('w:sz'), '18')
    bottom.set(qn('w:space'), '4'); bottom.set(qn('w:color'), 'C26B1E')
    pbdr.append(bottom); pPr.append(pbdr)
    return p

def add_h2(doc, text):
    p = doc.add_paragraph()
    r = p.add_run(text)
    r.font.size = Pt(12.5)
    r.font.bold = True
    r.font.color.rgb = INK
    p.paragraph_format.space_before = Pt(10)
    p.paragraph_format.space_after = Pt(3)
    return p

def add_body(doc, text, italic=False):
    p = doc.add_paragraph()
    r = p.add_run(text)
    r.italic = italic
    if italic:
        r.font.color.rgb = MUTE
    return p

def add_bullet(doc, text, bold_lead=None):
    p = doc.add_paragraph(style='List Bullet')
    if bold_lead:
        r = p.add_run(bold_lead)
        r.bold = True
        r.font.color.rgb = INK
        p.add_run("  " + text)
    else:
        p.add_run(text)
    p.paragraph_format.space_after = Pt(3)
    return p

def add_numbered(doc, text):
    p = doc.add_paragraph(style='List Number')
    p.add_run(text)
    p.paragraph_format.space_after = Pt(3)
    return p

def add_kv_table(doc, rows, col0="Feature", col1="What it is"):
    table = doc.add_table(rows=1, cols=2)
    table.alignment = WD_TABLE_ALIGNMENT.LEFT
    _no_table_borders(table)
    hdr = table.rows[0].cells
    for i, label in enumerate((col0, col1)):
        _set_cell_bg(hdr[i], '14181F')
        para = hdr[i].paragraphs[0]
        run = para.add_run(label.upper())
        run.font.color.rgb = RGBColor(0xFF, 0xFF, 0xFF)
        run.font.bold = True
        run.font.size = Pt(8.5)
    table.columns[0].width = Inches(2.2)
    table.columns[1].width = Inches(4.3)
    for k, v in rows:
        cells = table.add_row().cells
        cells[0].width = Inches(2.2)
        cells[1].width = Inches(4.3)
        rk = cells[0].paragraphs[0].add_run(k)
        rk.bold = True; rk.font.size = Pt(9.5); rk.font.color.rgb = INK
        rv = cells[1].paragraphs[0].add_run(v)
        rv.font.size = Pt(9.5); rv.font.color.rgb = INK2
    doc.add_paragraph().paragraph_format.space_after = Pt(2)
    return table

def add_callout(doc, label, text):
    table = doc.add_table(rows=1, cols=1)
    _no_table_borders(table)
    cell = table.rows[0].cells[0]
    _set_cell_bg(cell, 'F4F1EC')
    p = cell.paragraphs[0]
    r1 = p.add_run(label.upper() + "   ")
    r1.bold = True; r1.font.size = Pt(8.5); r1.font.color.rgb = ACCENT
    r1.font.name = 'Consolas'
    r2 = p.add_run(text)
    r2.font.size = Pt(9.5); r2.font.color.rgb = INK2
    doc.add_paragraph().paragraph_format.space_after = Pt(2)

def cover(doc, title, subtitle, kicker):
    # spacer
    for _ in range(3):
        doc.add_paragraph()
    add_eyebrow(doc, kicker)
    p = doc.add_paragraph()
    r = p.add_run(PRODUCT)
    r.font.size = Pt(13); r.font.bold = True; r.font.color.rgb = ACCENT
    r.font.name = 'Consolas'
    p2 = doc.add_paragraph()
    r2 = p2.add_run(title)
    r2.font.size = Pt(34); r2.font.bold = True; r2.font.color.rgb = INK
    p2.paragraph_format.space_after = Pt(4)
    p3 = doc.add_paragraph()
    r3 = p3.add_run(subtitle)
    r3.font.size = Pt(13); r3.font.color.rgb = MUTE
    # rule
    pr = doc.add_paragraph()
    pPr = pr._p.get_or_add_pPr()
    pbdr = OxmlElement('w:pBdr')
    bottom = OxmlElement('w:bottom')
    bottom.set(qn('w:val'), 'single'); bottom.set(qn('w:sz'), '24')
    bottom.set(qn('w:space'), '8'); bottom.set(qn('w:color'), 'C26B1E')
    pbdr.append(bottom); pPr.append(pbdr)
    for _ in range(8):
        doc.add_paragraph()
    pf = doc.add_paragraph()
    rf = pf.add_run(f"{TAGLINE}     •     {VERSION}     •     Confidential")
    rf.font.size = Pt(9); rf.font.color.rgb = MUTE
    doc.add_page_break()

# ===========================================================================
# 1) USER MANUAL  (reference)
# ===========================================================================
def build_manual():
    doc = Document()
    base_styles(doc)
    cover(doc,
          "Operator Manual",
          "A reference to every screen, module, and concept in the RAV command terminal.",
          "User Documentation")

    add_eyebrow(doc, "Section 1")
    add_h1(doc, "Overview")
    add_body(doc, "RAV is an endpoint-monitoring and insider-threat platform. A lightweight "
                  "agent runs on each managed Windows endpoint and streams activity — network, "
                  "process, file, and browser events, plus periodic screenshots — to a central "
                  "backend. A companion browser extension adds web-activity context. Captured "
                  "screenshots are passed through on-server OCR and matched against a list of "
                  "sensitive keywords; any hit flags the item as critical so investigators see it "
                  "first. Everything is reviewed through the web console, the ‘command terminal.’")
    add_h2(doc, "The four components")
    add_kv_table(doc, [
        ("Agent", "Silent, low-footprint Windows service. Collects telemetry + screenshots and forwards them. Installed per endpoint via an MSI and a deployment token."),
        ("Browser extension", "Force-installed companion that reports web-activity context back to the agent/backend."),
        ("Backend", "Central service that ingests events, stores evidence, runs OCR keyword scanning, and serves the API."),
        ("Command terminal", "The web dashboard you sign in to. All investigation, governance, and administration happens here."),
    ], col0="Component", col1="Role")

    add_eyebrow(doc, "Section 2")
    add_h1(doc, "Access & roles")
    add_body(doc, "What you can see and do depends on your assigned role. Menu items appear or "
                  "hide automatically to match your permissions.")
    add_kv_table(doc, [
        ("User", "Read-and-investigate access to their organization: Command Centre, Telemetry, Endpoints, Documents, Vault, alerts, tokens, keywords."),
        ("Org admin", "Everything a user can do, plus the Audit Trail and organization-level settings and identity."),
        ("Super admin", "Platform operator. Cross-organization Management, Log Ledger, Compliance Logs, and System Policies."),
    ], col0="Role", col1="Scope")

    add_eyebrow(doc, "Section 3")
    add_h1(doc, "Navigating the command terminal")
    add_body(doc, "The left sidebar is grouped into three areas. Below each group is the live "
                  "endpoint list, showing every enrolled device with an online (green) or offline "
                  "indicator; click any device to open its detail view.")
    add_kv_table(doc, [
        ("Investigation", "Command Centre · Telemetry · Endpoint Registry · Documents · Forensic Vault"),
        ("Governance", "Audit Trail · Forensic Alerts · Deployment Tokens · Sensitive Keywords"),
        ("Platform (super admin)", "Management · Log Ledger · Compliance Logs · System Policies"),
    ], col0="Sidebar group", col1="Screens")

    add_eyebrow(doc, "Section 4")
    add_h1(doc, "Investigation")

    add_h2(doc, "Command Centre")
    add_body(doc, "The landing dashboard. Summarizes the last 24 hours across all endpoints:")
    add_bullet(doc, "total events, unique remote IPs, warnings, and screenshots captured.", bold_lead="Stat row —")
    add_bullet(doc, "a breakdown by category (network, process, file, browser) and by severity (critical, high, medium, low).", bold_lead="Activity summary —")
    add_bullet(doc, "the most significant recent events, surfaced for quick triage.", bold_lead="Key events —")
    add_bullet(doc, "roster of enrolled endpoints with live status.", bold_lead="Enrolled agents —")
    add_bullet(doc, "per-user behavioural highlights drawn from the activity stream.", bold_lead="User insights —")
    add_callout(doc, "Tip", "Use the refresh control in the header to pull the latest 24-hour window on demand; the clock is synced from the server, not your browser.")

    add_h2(doc, "Telemetry")
    add_body(doc, "The full event stream from every endpoint. Each event carries a category "
                  "(network / process / file / browser), a severity, a timestamp, the originating "
                  "endpoint, and event-specific metadata (for example a remote IP for network "
                  "events). Use it to trace a sequence of activity end-to-end.")

    add_h2(doc, "Endpoint Registry")
    add_body(doc, "The inventory of managed devices. Each row shows the endpoint's display name or "
                  "hostname, its online/offline status, and health. Opening an endpoint reveals its "
                  "dedicated timeline — its telemetry, its screenshots, and any critical flags in one place.")

    add_h2(doc, "Documents")
    add_body(doc, "Files and document artifacts collected from endpoints, gathered for review in one list.")

    add_h2(doc, "Forensic Vault")
    add_body(doc, "The archive of retained evidence. Older captures and closed material are preserved "
                  "here so they remain retrievable for an investigation or an audit after they age out "
                  "of the live views.")

    add_eyebrow(doc, "Section 5")
    add_h1(doc, "Governance")

    add_h2(doc, "Audit Trail")
    add_body(doc, "An immutable log of console activity — who signed in, what was viewed, and which "
                  "administrative actions were taken. Org-admin only. This is the record you produce "
                  "to show the platform itself was used appropriately.")

    add_h2(doc, "Forensic Alerts")
    add_body(doc, "Notification preferences. Decide which events generate an alert (for example any "
                  "critical, keyword-flagged screenshot) and where those alerts are delivered.")

    add_h2(doc, "Deployment Tokens")
    add_body(doc, "Enrollment credentials for onboarding endpoints. A token carries a label, an agent "
                  "cap, and an expiry (24 hours by default). The MSI installer consumes the token to "
                  "bind a new endpoint to your organization. Tokens can be revoked at any time.")

    add_h2(doc, "Sensitive Keywords")
    add_body(doc, "The heart of content-level detection. Every screenshot is OCR-scanned and matched "
                  "against this list. A hit marks the screenshot critical and pushes it to the top of "
                  "the investigator's view. The list combines platform-wide defaults with your "
                  "organization's own additions. Plain terms match case-insensitively anywhere in the "
                  "text; advanced entries can be full regular expressions (e.g. card- or ID-number patterns).")

    add_eyebrow(doc, "Section 6")
    add_h1(doc, "Platform administration")
    add_body(doc, "Visible only to super admins operating the platform across organizations.")
    add_kv_table(doc, [
        ("Management", "Create and manage organizations, licences (agent caps), and users."),
        ("Log Ledger", "Cross-organization audit ledger of platform events."),
        ("Compliance Logs", "Compliance-oriented records for review and reporting."),
        ("System Policies", "Platform-wide policy configuration."),
    ], col0="Screen", col1="Purpose")

    add_eyebrow(doc, "Section 7")
    add_h1(doc, "Concepts reference")
    add_h2(doc, "Event severity")
    add_kv_table(doc, [
        ("Critical", "Highest priority — includes any screenshot whose OCR text matched a sensitive keyword."),
        ("High", "Notable activity warranting prompt review."),
        ("Medium", "Elevated activity; grouped with high as ‘warnings’ on the Command Centre."),
        ("Low", "Routine, informational activity."),
    ], col0="Severity", col1="Meaning")
    add_h2(doc, "Event categories")
    add_kv_table(doc, [
        ("Network", "Connections and remote-IP activity."),
        ("Process", "Programs launched and running on the endpoint."),
        ("File", "File creation, movement, and document activity."),
        ("Browser", "Web activity reported with help from the extension."),
    ], col0="Category", col1="Captures")

    add_eyebrow(doc, "Section 8")
    add_h1(doc, "Glossary")
    add_kv_table(doc, [
        ("Agent", "The endpoint-side collector service."),
        ("Enrollment / deployment token", "One-time credential that binds a new endpoint to an organization at install time."),
        ("OCR", "Optical character recognition — reads text out of screenshots so it can be keyword-matched."),
        ("Critical flag", "Set automatically when a screenshot's OCR text hits a sensitive keyword."),
        ("Endpoint", "A managed device running the agent."),
        ("Command terminal", "The RAV web console."),
    ], col0="Term", col1="Definition")

    path = os.path.join(OUT, "RAV_User_Manual.docx")
    doc.save(path)
    return path

# ===========================================================================
# 2) HOW-TO GUIDE  (tasks)
# ===========================================================================
def build_howto():
    doc = Document()
    base_styles(doc)
    cover(doc,
          "How-To Guide",
          "Short, task-by-task walkthroughs for getting real work done in RAV.",
          "User Documentation")

    add_body(doc, "Each task below is self-contained. Follow the numbered steps in order. Tasks are "
                  "grouped roughly in the order a new operator meets them: get in, deploy, watch, "
                  "investigate, and maintain.", italic=True)

    tasks = [
        ("Sign in for the first time", [
            "Open the RAV console URL in your browser.",
            "Enter the username and password issued to you.",
            "If prompted to change your password on first login, set a new one — this is required before you can continue.",
            "You land on the Command Centre. The sidebar shows only the areas your role allows.",
        ]),
        ("Create a deployment token", [
            "In the sidebar, under Governance, open Deployment Tokens.",
            "Click New / Add token.",
            "Give it a label (e.g. ‘Finance laptops – March’), set the maximum number of agents it may enroll, and set an expiry (defaults to 24 hours).",
            "Save. Copy the generated token immediately — you will need it for the installer.",
        ]),
        ("Enroll a Windows endpoint", [
            "Copy the RAVAgent.msi installer to the target endpoint.",
            "Open an elevated (Administrator) command prompt.",
            "Run the installer with your server URL and token, for example:",
            "    msiexec /i RAVAgent.msi BACKEND_URL=\"https://yikes.cam\" ENROLLMENT_TOKEN=\"<your-token>\" /qn",
            "The agent installs silently, binds to your organization, and begins reporting. The endpoint typically restarts the service once right after enrollment.",
        ]),
        ("Confirm an endpoint is reporting", [
            "Open Endpoint Registry (or watch the live endpoint list at the bottom of the sidebar).",
            "Find the new device by hostname or display name.",
            "Confirm its status indicator is green (online).",
            "Open the device to verify events and screenshots are arriving on its timeline.",
        ]),
        ("Read the Command Centre at a glance", [
            "Open Command Centre (home).",
            "Scan the stat row: total events, unique IPs, warnings, and screenshots in the last 24 hours.",
            "Check the severity breakdown — a rising critical count is your first cue to investigate.",
            "Use Key Events for the most significant recent items, then click through for detail.",
            "Press refresh in the header to pull the latest window.",
        ]),
        ("Investigate a critical event", [
            "From Command Centre Key Events or the Telemetry stream, filter or look for critical severity.",
            "Open the event to see its category, timestamp, originating endpoint, and metadata.",
            "Pivot to that endpoint's detail view to see what happened immediately before and after.",
            "If the critical flag came from a screenshot, review the image and the keyword that triggered it (next task).",
        ]),
        ("Review screenshots flagged by OCR", [
            "Open the endpoint's detail view, or filter Telemetry to screenshot events.",
            "Critical screenshots are those whose extracted text matched a sensitive keyword.",
            "Open the screenshot to see the captured screen and the matched term(s).",
            "Decide whether it is a true finding; escalate or archive to the Forensic Vault as needed.",
        ]),
        ("Add or edit a sensitive keyword", [
            "Under Governance, open Sensitive Keywords.",
            "Review existing entries — platform defaults plus your organization's own additions.",
            "Add a new term. Use a plain word or phrase for a simple case-insensitive match anywhere in a screenshot's text.",
            "For patterns (card numbers, ID formats), add it as a regular-expression entry.",
            "Save. New screenshots are matched against the updated list as they are processed. (Already-scanned images are not re-flagged automatically.)",
        ]),
        ("Configure forensic alerts", [
            "Under Governance, open Forensic Alerts.",
            "Choose which conditions raise an alert — for example, any critical keyword hit.",
            "Set where alerts are delivered.",
            "Save. You will now be notified without having to watch the dashboard continuously.",
        ]),
        ("Review a specific endpoint's activity", [
            "Open Endpoint Registry and select the device (or click it in the sidebar list).",
            "Read its timeline top-to-bottom: telemetry, screenshots, and critical flags in one place.",
            "Use it to build a per-user or per-device narrative for a report.",
        ]),
        ("Retrieve evidence from the Forensic Vault", [
            "Open Forensic Vault under Investigation.",
            "Locate the retained capture or archived material you need.",
            "Open or export it for your case file, HR, or legal review.",
        ]),
        ("Review the audit trail (org admin)", [
            "Under Governance, open Audit Trail.",
            "Review who signed in and which actions were taken in the console.",
            "Use this to demonstrate the platform itself was used appropriately.",
        ]),
        ("Revoke a token or decommission an endpoint", [
            "To stop further enrollments on a token: open Deployment Tokens and revoke it.",
            "Revoking a token does not remove endpoints already enrolled with it.",
            "To retire a device, uninstall the agent on the endpoint and confirm it drops to offline in the Endpoint Registry.",
        ]),
    ]

    for i, (title, steps) in enumerate(tasks, 1):
        add_eyebrow(doc, f"How-to {i:02d}")
        add_h1(doc, title)
        for s in steps:
            if s.startswith("    "):
                # monospace command line
                p = doc.add_paragraph()
                r = p.add_run(s.strip())
                r.font.name = 'Consolas'; r.font.size = Pt(9.5)
                r.font.color.rgb = INK
                p.paragraph_format.left_indent = Inches(0.5)
                _shade = p._p.get_or_add_pPr()
                shd = OxmlElement('w:shd'); shd.set(qn('w:val'),'clear')
                shd.set(qn('w:color'),'auto'); shd.set(qn('w:fill'),'F4F1EC')
                _shade.append(shd)
            else:
                add_numbered(doc, s)

    add_callout(doc, "Reference", "For what any screen or term means, see the companion RAV Operator Manual.")

    path = os.path.join(OUT, "RAV_How_To_Guide.docx")
    doc.save(path)
    return path

# ===========================================================================
# 3) BUSINESS-CASE DECK  (pptx)
# ===========================================================================
def _blank(prs):
    return prs.slides.add_slide(prs.slide_layouts[6])

def _bg(slide, prs, color=P_BG):
    slide.background.fill.solid()
    slide.background.fill.fore_color.rgb = color

def _box(slide, l, t, w, h):
    return slide.shapes.add_textbox(PInches(l), PInches(t), PInches(w), PInches(h)).text_frame

def _rect(slide, l, t, w, h, fill=None, line=None, line_w=0.75):
    from pptx.enum.shapes import MSO_SHAPE
    sp = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, PInches(l), PInches(t), PInches(w), PInches(h))
    sp.shadow.inherit = False
    if fill is None:
        sp.fill.background()
    else:
        sp.fill.solid(); sp.fill.fore_color.rgb = fill
    if line is None:
        sp.line.fill.background()
    else:
        sp.line.color.rgb = line; sp.line.width = PPt(line_w)
    return sp

def _run(p, text, size, color, bold=False, font='Calibri', spacing=None, italic=False):
    r = p.add_run(); r.text = text
    r.font.size = PPt(size); r.font.bold = bold; r.font.italic = italic
    r.font.color.rgb = color; r.font.name = font
    return r

def _eyebrow(slide, text, l=0.9, t=0.55):
    tf = _box(slide, l, t, 8, 0.4); tf.word_wrap = True
    p = tf.paragraphs[0]
    _run(p, text.upper(), 12, P_ACCENT, bold=True, font='Consolas')
    return tf

def _title(slide, text, l=0.9, t=0.95, w=11.5, size=34):
    tf = _box(slide, l, t, w, 1.4); tf.word_wrap = True
    p = tf.paragraphs[0]
    _run(p, text, size, P_INK, bold=True)
    return tf

def _accent_bar(slide, l=0.92, t=1.75, w=0.9):
    _rect(slide, l, t, w, 0.055, fill=P_ACCENT)

def _footer(slide, idx):
    tf = _box(slide, 0.9, 7.0, 11.5, 0.35)
    p = tf.paragraphs[0]
    _run(p, f"{PRODUCT.upper()}", 8.5, P_MUTE, font='Consolas')
    _run(p, f"     {TAGLINE}", 8.5, P_MUTE)
    p2 = _box(slide, 11.7, 7.0, 1.2, 0.35).paragraphs[0]
    p2.alignment = PP_ALIGN.RIGHT
    _run(p2, f"{idx:02d}", 8.5, P_MUTE, font='Consolas')

def _bullets(slide, items, l=0.95, t=2.1, w=11.4, size=15, gap=10):
    tf = _box(slide, l, t, w, 4.6); tf.word_wrap = True
    first = True
    for it in items:
        lead, body = (it if isinstance(it, tuple) else (None, it))
        p = tf.paragraphs[0] if first else tf.add_paragraph()
        first = False
        p.space_after = PPt(gap)
        _run(p, "—  ", size, P_ACCENT, bold=True)
        if lead:
            _run(p, lead + "  ", size, P_INK, bold=True)
        _run(p, body, size, P_MUTE)
    return tf

def build_deck():
    prs = Presentation()
    prs.slide_width = PInches(13.333)
    prs.slide_height = PInches(7.5)

    # -- Slide 1: title
    s = _blank(prs); _bg(s, prs)
    _rect(s, 0, 0, 0.32, 7.5, fill=P_ACCENT)
    tf = _box(s, 0.9, 2.35, 11.5, 0.5)
    _run(tf.paragraphs[0], PRODUCT.upper(), 15, P_ACCENT, bold=True, font='Consolas')
    tf2 = _box(s, 0.88, 2.85, 11.6, 1.8); tf2.word_wrap = True
    _run(tf2.paragraphs[0], "See the threat inside", 52, P_INK, bold=True)
    tf3 = _box(s, 0.92, 4.35, 10.8, 1.0); tf3.word_wrap = True
    _run(tf3.paragraphs[0],
         "Endpoint intelligence, content-aware screenshot analysis, and evidence-grade "
         "forensics — in one command terminal.", 17, P_MUTE)
    tf4 = _box(s, 0.92, 6.6, 11.5, 0.4)
    _run(tf4.paragraphs[0], "BUSINESS CASE  ·  CONFIDENTIAL", 10, P_MUTE, font='Consolas')

    # -- Slide 2: the problem
    s = _blank(prs); _bg(s, prs)
    _eyebrow(s, "The problem"); _title(s, "The most costly threats already have a login"); _accent_bar(s)
    _bullets(s, [
        ("Insiders are trusted.", "Employees, contractors and compromised accounts operate inside the perimeter, with legitimate access. Firewalls and antivirus were never designed to see them."),
        ("Data leaves quietly.", "A copied client list, a screenshot of credentials, a file dragged to personal webmail — the damaging moment is often a single screen, and it leaves no obvious trace."),
        ("Alerts without evidence.", "Traditional tools raise a flag but can't show you what was actually on the screen — so investigations stall and HR/legal cases can't be proven."),
        ("Blind between the endpoints.", "Activity is scattered across devices, browsers and logs with no single, time-ordered picture of what a person actually did."),
    ])
    _footer(s, 2)

    # -- Slide 3: cost of inaction
    s = _blank(prs); _bg(s, prs)
    _eyebrow(s, "Why it matters"); _title(s, "The cost of finding out too late"); _accent_bar(s)
    # three stat panels
    stats = [
        ("Months", "Insider incidents routinely go undetected for weeks to months — long after the data is gone."),
        ("No proof", "Without the actual screen content, a suspicion rarely becomes an actionable, defensible case."),
        ("Repeat risk", "What isn't seen isn't deterred. Undetected behaviour is repeated — and copied by others."),
    ]
    x = 0.95
    for big, body in stats:
        _rect(s, x, 2.25, 3.7, 3.4, fill=P_PANEL, line=P_LINE)
        tf = _box(s, x+0.35, 2.65, 3.0, 1.0)
        _run(tf.paragraphs[0], big, 30, P_ACCENT, bold=True)
        tf2 = _box(s, x+0.35, 3.75, 3.05, 1.7); tf2.word_wrap = True
        _run(tf2.paragraphs[0], body, 13.5, P_MUTE)
        x += 3.95
    _footer(s, 3)

    # -- Slide 4: the solution
    s = _blank(prs); _bg(s, prs)
    _eyebrow(s, "The solution"); _title(s, "RAV watches the endpoint the way an investigator would"); _accent_bar(s)
    _bullets(s, [
        ("A silent agent on every endpoint.", "Low-footprint Windows service streams network, process, file and browser activity plus periodic screenshots — continuously and unobtrusively."),
        ("It reads the screen, not just the metadata.", "On-server OCR turns every screenshot into searchable text and matches it against your sensitive-keyword list."),
        ("The important things surface themselves.", "A keyword hit flags the capture critical and pushes it to the top — investigators see what matters first, not last."),
        ("Every finding is evidence.", "Screens, timelines and context are retained in a forensic vault, ready for HR, legal or audit."),
    ])
    _footer(s, 4)

    # -- Slide 5: how it works
    s = _blank(prs); _bg(s, prs)
    _eyebrow(s, "How it works"); _title(s, "Four parts, one pipeline"); _accent_bar(s)
    flow = [
        ("Agent", "Captures telemetry + screenshots on the endpoint"),
        ("Extension", "Adds web-activity context"),
        ("Backend + OCR", "Ingests, reads screens, matches keywords, flags critical"),
        ("Command terminal", "Investigate, alert, govern, retain"),
    ]
    x = 0.95
    for i,(t_,b_) in enumerate(flow):
        _rect(s, x, 2.55, 2.65, 2.6, fill=P_PANEL, line=P_LINE)
        tf = _box(s, x+0.22, 2.8, 2.25, 0.6)
        _run(tf.paragraphs[0], f"0{i+1}", 12, P_ACCENT, bold=True, font='Consolas')
        tf2 = _box(s, x+0.22, 3.25, 2.25, 0.6)
        _run(tf2.paragraphs[0], t_, 16, P_INK, bold=True)
        tf3 = _box(s, x+0.22, 3.85, 2.28, 1.2); tf3.word_wrap = True
        _run(tf3.paragraphs[0], b_, 12, P_MUTE)
        if i < 3:
            ar = _box(s, x+2.62, 3.35, 0.35, 0.6)
            _run(ar.paragraphs[0], "›", 26, P_ACCENT, bold=True)
        x += 3.0
    _footer(s, 5)

    # -- Slide 6: capabilities
    s = _blank(prs); _bg(s, prs)
    _eyebrow(s, "Capabilities"); _title(s, "What you get on day one"); _accent_bar(s)
    caps = [
        ("Continuous telemetry", "Network, process, file and browser events, time-ordered per endpoint."),
        ("Screenshot + OCR", "Every screen read and made keyword-searchable automatically."),
        ("Sensitive-keyword flagging", "Your terms and patterns; critical hits float to the top."),
        ("Command Centre", "24-hour posture at a glance — volumes, severities, key events."),
        ("Forensic Vault", "Evidence retained and retrievable for cases and audits."),
        ("Audit & roles", "Role-based access and an immutable trail of console activity."),
    ]
    x, y = 0.95, 2.2
    for i,(t_,b_) in enumerate(caps):
        col = i % 2; row = i // 2
        cx = 0.95 + col*6.1; cy = 2.2 + row*1.55
        _rect(s, cx, cy, 5.8, 1.35, fill=P_PANEL, line=P_LINE)
        tf = _box(s, cx+0.3, cy+0.18, 5.3, 0.5)
        _run(tf.paragraphs[0], t_, 15, P_INK, bold=True)
        tf2 = _box(s, cx+0.3, cy+0.62, 5.3, 0.7); tf2.word_wrap = True
        _run(tf2.paragraphs[0], b_, 12, P_MUTE)
    _footer(s, 6)

    # -- Slide 7: differentiators
    s = _blank(prs); _bg(s, prs)
    _eyebrow(s, "Why RAV"); _title(s, "Content-level, not just click-level"); _accent_bar(s)
    _bullets(s, [
        ("It sees meaning, not just events.", "OCR keyword matching detects the sensitive content itself — a leaked name, number or phrase on screen — which log-only tools miss entirely."),
        ("Signal, not noise.", "Automatic critical-flagging means analysts spend time on the few captures that matter, not scrolling thousands that don't."),
        ("Evidence by default.", "Every alert is backed by the actual screen and its timeline — ready to stand up in an HR or legal process."),
        ("Deploys in minutes, unobtrusively.", "One MSI and a deployment token per endpoint; a quiet, low-footprint agent that doesn't get in users' way."),
    ])
    _footer(s, 7)

    # -- Slide 8: business case / ROI
    s = _blank(prs); _bg(s, prs)
    _eyebrow(s, "The business case"); _title(s, "What it returns"); _accent_bar(s)
    roi = [
        ("Detect sooner", "Content-aware flagging cuts the gap between a risky action and someone seeing it — from months to the same day."),
        ("Prove it", "Screen-level evidence turns suspicion into a defensible case, protecting the organization in disputes."),
        ("Deter it", "Consistent, visible monitoring changes behaviour — the cheapest incident is the one that never happens."),
        ("Consolidate", "One terminal replaces scattered logs and manual review, lowering the effort per investigation."),
    ]
    x = 0.95
    for i,(t_,b_) in enumerate(roi):
        col = i % 2; row = i // 2
        cx = 0.95 + col*6.1; cy = 2.2 + row*2.15
        _rect(s, cx, cy, 5.8, 1.9, fill=P_PANEL, line=P_LINE)
        _rect(s, cx, cy, 0.09, 1.9, fill=P_ACCENT)
        tf = _box(s, cx+0.35, cy+0.25, 5.2, 0.5)
        _run(tf.paragraphs[0], t_, 17, P_INK, bold=True)
        tf2 = _box(s, cx+0.35, cy+0.8, 5.25, 1.0); tf2.word_wrap = True
        _run(tf2.paragraphs[0], b_, 13, P_MUTE)
    _footer(s, 8)

    # -- Slide 9: deployment & governance
    s = _blank(prs); _bg(s, prs)
    _eyebrow(s, "Adoption"); _title(s, "Simple to deploy, built to be governed"); _accent_bar(s)
    _bullets(s, [
        ("Rollout.", "Issue a deployment token, push the MSI, done. Endpoints enroll silently and start reporting immediately."),
        ("Scale by licence.", "Organizations are provisioned with an agent cap; add endpoints up to your licence at any time."),
        ("Least privilege.", "Three roles — user, org admin, super admin — so people see exactly what they should, and no more."),
        ("Accountable by design.", "Row-level data isolation between organizations and an immutable audit trail of console activity."),
    ])
    _footer(s, 9)

    # -- Slide 10: close
    s = _blank(prs); _bg(s, prs)
    _rect(s, 0, 0, 0.32, 7.5, fill=P_ACCENT)
    tf = _box(s, 0.9, 2.5, 11.5, 0.5)
    _run(tf.paragraphs[0], "NEXT STEP", 13, P_ACCENT, bold=True, font='Consolas')
    tf2 = _box(s, 0.88, 3.0, 11.5, 1.5); tf2.word_wrap = True
    _run(tf2.paragraphs[0], "Run a pilot on ten endpoints", 40, P_INK, bold=True)
    tf3 = _box(s, 0.92, 4.35, 10.8, 1.2); tf3.word_wrap = True
    _run(tf3.paragraphs[0],
         "Deploy in an afternoon, watch the first critical flags land within the week, and "
         "measure detection on your own data before you commit.", 16, P_MUTE)
    _footer(s, 10)

    path = os.path.join(OUT, "RAV_Business_Case.pptx")
    prs.save(path)
    return path

# ===========================================================================
if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    m = build_manual()
    h = build_howto()
    d = build_deck()
    print("Wrote:")
    for p in (m, h, d):
        print("  ", p, f"({os.path.getsize(p)//1024} KB)")
