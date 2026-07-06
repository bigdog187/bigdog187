#!/usr/bin/env python3
"""
Instagram ad generator for Weiley Electrical (wyelec.com.au) — v2 "SCHEMATIC".

Design language: engineering blueprint / electrical schematic.
 - deep ink-blue drafting grid with registration crosshairs
 - circuit-bus service lists with junction nodes
 - faux-glow (radial gradients), ghost outline display type
 - monospace annotations, dimension lines, pulse waves, halftone fades
 - engineering title-block footer
Palette: red / white / blue.

Run:  python3 generate_ads.py
"""

import os
import html
import math
import cairosvg

# ----------------------------------------------------------------------------
# Brand system  —  red / white / blue
# ----------------------------------------------------------------------------
INK     = "#06152C"   # page ground (deep ink blue)
BLUE    = "#0B2B57"   # primary blue
PANEL   = "#0C2750"   # card / panel fill
BLUE_L  = "#14417F"   # lighter structural blue
GRIDC   = "#2A5EA8"   # blueprint grid line
LINE    = "#28517F"   # structural strokes
RED     = "#FF3B3B"   # electric red
RED_D   = "#D22C2C"   # deep red
WHITE   = "#FFFFFF"
MIST    = "#A9C3E8"   # muted light blue

FONT   = "DejaVu Sans, Liberation Sans, sans-serif"
FONT_M = "DejaVu Sans Mono, Liberation Mono, monospace"

SIZE = 1080
OUT  = os.path.dirname(os.path.abspath(__file__))

PHONE = "02 6884 9292"
EMAIL = "service@wyelec.com.au"
ADDR  = "Unit 9B, 55 Wheelers Lane, Dubbo NSW 2830"
HOURS = "Mon–Fri 7:30am–4pm • 24/7 industrial breakdown"


def esc(s):
    return html.escape(str(s), quote=True)


# ----------------------------------------------------------------------------
# Chrome: defs, grid, crosshairs, title block
# ----------------------------------------------------------------------------
def defs():
    return (
        '<defs>'
        f'<radialGradient id="gRed" cx="0.5" cy="0.5" r="0.5">'
        f'<stop offset="0" stop-color="{RED}" stop-opacity="0.55"/>'
        f'<stop offset="0.55" stop-color="{RED}" stop-opacity="0.18"/>'
        f'<stop offset="1" stop-color="{RED}" stop-opacity="0"/></radialGradient>'
        f'<radialGradient id="gWhite" cx="0.5" cy="0.5" r="0.5">'
        f'<stop offset="0" stop-color="{WHITE}" stop-opacity="0.30"/>'
        f'<stop offset="1" stop-color="{WHITE}" stop-opacity="0"/></radialGradient>'
        f'<linearGradient id="ink" x1="0" y1="0" x2="0.8" y2="1">'
        f'<stop offset="0" stop-color="{BLUE}"/>'
        f'<stop offset="1" stop-color="{INK}"/></linearGradient>'
        '</defs>'
    )


def grid():
    """Blueprint drafting grid: fine minor lines, stronger major lines."""
    p = []
    for i in range(0, SIZE + 1, 40):
        op = 0.10 if i % 200 == 0 else 0.045
        p.append(f'<line x1="{i}" y1="0" x2="{i}" y2="{SIZE}" stroke="{GRIDC}" stroke-width="1" opacity="{op}"/>')
        p.append(f'<line x1="0" y1="{i}" x2="{SIZE}" y2="{i}" stroke="{GRIDC}" stroke-width="1" opacity="{op}"/>')
    return "".join(p)


def crosshair(x, y, r=14, op=0.55):
    return (
        f'<g stroke="{MIST}" stroke-width="1.5" opacity="{op}">'
        f'<line x1="{x-r}" y1="{y}" x2="{x+r}" y2="{y}"/>'
        f'<line x1="{x}" y1="{y-r}" x2="{x}" y2="{y+r}"/>'
        f'<circle cx="{x}" cy="{y}" r="{r*0.55}" fill="none"/></g>'
    )


def title_block():
    """Engineering-drawing title block as the footer."""
    y0, h = 968, 78
    yb = y0 + h / 2
    return (
        f'<rect x="0" y="{y0}" width="{SIZE}" height="{SIZE-y0}" fill="#050F20"/>'
        f'<rect x="0" y="{y0}" width="{SIZE}" height="3" fill="{RED}"/>'
        f'<line x1="392" y1="{y0+12}" x2="392" y2="{y0+h-12}" stroke="{LINE}" stroke-width="1.5"/>'
        f'<line x1="712" y1="{y0+12}" x2="712" y2="{y0+h-12}" stroke="{LINE}" stroke-width="1.5"/>'
        f'<text x="40" y="{yb-2}" font-family="{FONT_M}" font-size="17" font-weight="bold" fill="{WHITE}">WEILEY ELECTRICAL</text>'
        f'<text x="40" y="{yb+22}" font-family="{FONT_M}" font-size="14" fill="{MIST}">DUBBO &#8226; CENTRAL WEST NSW &#8226; EST. 1986</text>'
        f'<text x="552" y="{yb+9}" text-anchor="middle" font-family="{FONT}" font-size="27" font-weight="bold" fill="{WHITE}">wyelec.com.au</text>'
        f'<text x="876" y="{yb+9}" text-anchor="middle" font-family="{FONT}" font-size="27" font-weight="bold" fill="{RED}">{PHONE}</text>'
    )


def chrome():
    return (
        f'<rect width="{SIZE}" height="{SIZE}" fill="url(#ink)"/>'
        f'{grid()}'
        f'{crosshair(40, 40)}{crosshair(1040, 40)}{crosshair(40, 928)}{crosshair(1040, 928)}'
        f'{title_block()}'
    )


def frame(inner):
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{SIZE}" height="{SIZE}" '
        f'viewBox="0 0 {SIZE} {SIZE}">{defs()}{inner}</svg>'
    )


# ----------------------------------------------------------------------------
# Motifs
# ----------------------------------------------------------------------------
def glow(cx, cy, r, gid="gRed", op=1.0):
    return f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="url(#{gid})" opacity="{op}"/>'


def bolt(cx, cy, scale=1.0, fill=RED, opacity=1.0):
    return (
        f'<g transform="translate({cx},{cy}) scale({scale}) translate(-50,-75)">'
        f'<path d="M58,4 L20,84 L46,84 L32,146 L92,60 L60,60 Z" '
        f'fill="{fill}" opacity="{opacity}"/></g>'
    )


def logo(x, y, s=1.0):
    """Circle badge bolt + wordmark."""
    return (
        f'{glow(x + 34*s, y + 34*s, 64*s, "gRed", 0.8)}'
        f'<circle cx="{x+34*s}" cy="{y+34*s}" r="{33*s}" fill="{RED}"/>'
        f'<circle cx="{x+34*s}" cy="{y+34*s}" r="{40*s}" fill="none" stroke="{RED}" stroke-width="{1.6*s}" opacity="0.6"/>'
        f'{bolt(x + 34*s, y + 34*s, scale=0.40*s, fill=WHITE)}'
        f'<text x="{x+94*s}" y="{y+30*s}" font-family="{FONT}" font-size="{31*s}" font-weight="bold" '
        f'letter-spacing="{2*s}" fill="{WHITE}">WEILEY</text>'
        f'<text x="{x+95*s}" y="{y+60*s}" font-family="{FONT_M}" font-size="{17*s}" font-weight="bold" '
        f'letter-spacing="{8.2*s}" fill="{RED}">ELECTRICAL</text>'
    )


def kicker(x, y, text, fs=21):
    return (
        f'<text x="{x}" y="{y}" font-family="{FONT_M}" font-size="{fs}" font-weight="bold" '
        f'letter-spacing="3" fill="{RED}">[ {esc(text)} ]</text>'
    )


def ghost(x, y, word, fs=250, op=0.10):
    return (
        f'<text x="{x}" y="{y}" font-family="{FONT}" font-size="{fs}" font-weight="bold" '
        f'letter-spacing="8" fill="none" stroke="{MIST}" stroke-width="2" opacity="{op}">{esc(word)}</text>'
    )


def dim_line(x1, x2, y, label):
    return (
        f'<g stroke="{MIST}" stroke-width="1.5" opacity="0.75">'
        f'<line x1="{x1}" y1="{y}" x2="{x2}" y2="{y}"/>'
        f'<line x1="{x1}" y1="{y-9}" x2="{x1}" y2="{y+9}"/>'
        f'<line x1="{x2}" y1="{y-9}" x2="{x2}" y2="{y+9}"/></g>'
        f'<rect x="{(x1+x2)/2 - len(label)*5.4 - 14:.0f}" y="{y-13}" width="{len(label)*10.8 + 28:.0f}" height="26" fill="{INK}"/>'
        f'<text x="{(x1+x2)/2:.0f}" y="{y+6}" text-anchor="middle" font-family="{FONT_M}" '
        f'font-size="16" letter-spacing="2" fill="{MIST}">{esc(label)}</text>'
    )


def pulse(x, y, w, h=22, unit=34, stroke=RED, sw=3, op=0.9):
    """Square pulse wave."""
    d = f'M{x},{y}'
    cx = x
    up = False
    while cx + unit <= x + w:
        d += f' h{unit*0.45:.0f} v{-h if not up else h} h{unit*0.55:.0f} v{h if not up else -h}'
        cx += unit
    d += f' L{x+w},{y}'
    return f'<path d="{d}" fill="none" stroke="{stroke}" stroke-width="{sw}" opacity="{op}" stroke-linejoin="round"/>'


def halftone(x0, y0, cols, rows, gap=26, r0=5.0, op=0.20):
    """Dot grid fading toward bottom-right."""
    p = []
    for i in range(cols):
        for j in range(rows):
            t = 1 - (i / max(cols - 1, 1) + j / max(rows - 1, 1)) / 2
            r = r0 * (0.25 + 0.75 * t)
            p.append(f'<circle cx="{x0+i*gap}" cy="{y0+j*gap}" r="{r:.1f}" fill="{MIST}" opacity="{op}"/>')
    return "".join(p)


def node(cx, cy, r=7):
    return (
        f'<circle cx="{cx}" cy="{cy}" r="{r+6}" fill="url(#gRed)"/>'
        f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="{RED}"/>'
        f'<circle cx="{cx}" cy="{cy}" r="{r*0.36:.1f}" fill="{WHITE}"/>'
    )


def pad(x, y, s=11):
    return f'<rect x="{x-s/2}" y="{y-s/2}" width="{s}" height="{s}" fill="{RED}" transform="rotate(45 {x} {y})"/>'


def bus_list(x, y0, items, step=58, fs=26):
    """Vertical circuit bus with junction nodes; one service per node."""
    y_last = y0 + (len(items) - 1) * step
    p = [
        f'<line x1="{x}" y1="{y0-34}" x2="{x}" y2="{y_last+34}" stroke="{BLUE_L}" stroke-width="3"/>',
        pad(x, y0 - 40), pad(x, y_last + 40),
    ]
    for i, t in enumerate(items):
        y = y0 + i * step
        p.append(node(x, y))
        p.append(
            f'<text x="{x+30}" y="{y+9}" font-family="{FONT}" font-size="{fs}" '
            f'fill="{WHITE}">{esc(t)}</text>'
        )
    return "".join(p)


def cta_pill(x, y, text, fs=27, w=None):
    tw = len(text) * fs * 0.68 + len(text) * 1.5
    w = w or tw + 110
    h = fs + 38
    return (
        f'{glow(x + w/2, y + h/2, w*0.55, "gRed", 0.5)}'
        f'<rect x="{x}" y="{y}" width="{w:.0f}" height="{h}" rx="{h/2}" fill="{RED}"/>'
        f'{bolt(x + 36, y + h/2, scale=0.30, fill=WHITE)}'
        f'<text x="{x + 60}" y="{y+h/2+fs*0.35:.0f}" font-family="{FONT}" font-size="{fs}" '
        f'font-weight="bold" letter-spacing="1.5" fill="{WHITE}">{esc(text)}</text>'
    )


def iso_chip(x, y, text, w=216):
    return (
        f'<rect x="{x}" y="{y}" width="{w}" height="46" rx="8" fill="{PANEL}" stroke="{LINE}" stroke-width="1.5"/>'
        f'<circle cx="{x+26}" cy="{y+23}" r="6" fill="{RED}"/>'
        f'<text x="{x+44}" y="{y+30}" font-family="{FONT_M}" font-size="18" font-weight="bold" '
        f'fill="{MIST}">{esc(text)}</text>'
    )


def stamp(cx, cy, rot=-12, r=150):
    """Rubber-stamp inspection seal."""
    return (
        f'<g transform="translate({cx},{cy}) rotate({rot})" opacity="0.96">'
        f'{glow(0, 0, r*1.25, "gRed", 0.45)}'
        f'<circle cx="0" cy="0" r="{r}" fill="none" stroke="{RED}" stroke-width="5"/>'
        f'<circle cx="0" cy="0" r="{r-30}" fill="none" stroke="{RED}" stroke-width="2"/>'
        f'<text x="0" y="-76" text-anchor="middle" font-family="{FONT_M}" font-size="20" '
        f'font-weight="bold" letter-spacing="4" fill="{RED}">CERTIFIED</text>'
        f'<text x="0" y="-16" text-anchor="middle" font-family="{FONT}" font-size="46" '
        f'font-weight="bold" letter-spacing="2" fill="{RED}">AUDIT</text>'
        f'<text x="0" y="36" text-anchor="middle" font-family="{FONT}" font-size="46" '
        f'font-weight="bold" letter-spacing="2" fill="{RED}">READY</text>'
        f'<text x="0" y="86" text-anchor="middle" font-family="{FONT_M}" font-size="16" '
        f'font-weight="bold" letter-spacing="1" fill="{RED}">ISO 9001 &#183; 45001</text>'
        f'<circle cx="-104" cy="0" r="4" fill="{RED}"/><circle cx="104" cy="0" r="4" fill="{RED}"/>'
        f'</g>'
    )


# ----------------------------------------------------------------------------
# 01 — Brand / hero
# ----------------------------------------------------------------------------
def ad_hero():
    inner = (
        f'{chrome()}'
        f'{ghost(430, 705, "POWER", fs=265, op=0.07)}'
        f'{halftone(820, 120, 8, 6, gap=28, r0=4.5, op=0.16)}'
        # glowing bolt, wired to the right edge
        f'{glow(896, 500, 240, "gRed", 0.9)}'
        f'<line x1="896" y1="240" x2="896" y2="360" stroke="{BLUE_L}" stroke-width="3"/>'
        f'<line x1="896" y1="640" x2="896" y2="780" stroke="{BLUE_L}" stroke-width="3"/>'
        f'{pad(896, 234)}{pad(896, 786)}'
        f'{bolt(896, 500, scale=2.5, fill=RED)}'
        f'{bolt(888, 492, scale=2.5, fill=WHITE, opacity=0.16)}'
        f'{logo(64, 64, s=1.12)}'
        f'{kicker(64, 262, "EST. 1986 — 40+ YEARS IN SERVICE")}'
        f'<text x="60" y="392" font-family="{FONT}" font-size="86" font-weight="bold" fill="{WHITE}">KEEPING</text>'
        f'<text x="60" y="484" font-family="{FONT}" font-size="86" font-weight="bold" fill="{WHITE}">CENTRAL WEST</text>'
        f'<text x="60" y="576" font-family="{FONT}" font-size="86" font-weight="bold" fill="{RED}">BUSINESSES</text>'
        f'<text x="60" y="668" font-family="{FONT}" font-size="86" font-weight="bold" fill="{RED}">POWERED</text>'
        f'{dim_line(64, 620, 716, "SINCE 1986 — DUBBO NSW")}'
        f'<text x="64" y="796" font-family="{FONT_M}" font-size="24" letter-spacing="2" fill="{MIST}">'
        f'INDUSTRIAL &#8226; COMMERCIAL &#8226; COMPLIANCE</text>'
        f'<text x="64" y="840" font-family="{FONT_M}" font-size="24" letter-spacing="2" fill="{MIST}">'
        f'ISO 9001 &amp; 45001 &#8226; FREE QUOTES</text>'
        f'{pulse(64, 902, 500)}'
    )
    return frame(inner)


# ----------------------------------------------------------------------------
# 02 — Industrial
# ----------------------------------------------------------------------------
def ad_industrial():
    left  = ["PLC, SCADA & HMI systems", "Machinery wiring & automation",
             "Instrumentation & controls", "Telemetry & remote monitoring",
             "New installs & upgrades"]
    right = ["Control panel design & build", "Hazardous area electrical",
             "Pump control & diagnostics", "Fault finding & repairs",
             "Preventive plant maintenance"]
    inner = (
        f'{chrome()}'
        f'{ghost(560, 330, "24/7", fs=250, op=0.09)}'
        f'{logo(64, 64, s=0.9)}'
        f'{kicker(64, 216, "INDUSTRIAL DIVISION")}'
        f'<text x="60" y="316" font-family="{FONT}" font-size="88" font-weight="bold" fill="{WHITE}">INDUSTRIAL</text>'
        f'<text x="62" y="404" font-family="{FONT}" font-size="88" font-weight="bold" fill="none" '
        f'stroke="{RED}" stroke-width="3">ELECTRICAL</text>'
        f'<text x="64" y="462" font-family="{FONT_M}" font-size="22" letter-spacing="2" fill="{MIST}">'
        f'FOUR DECADES KEEPING PLANTS &amp; MACHINERY RUNNING</text>'
        f'{bus_list(80, 548, left, step=62, fs=25)}'
        f'{bus_list(600, 548, right, step=62, fs=25)}'
        f'{cta_pill(64, 858, "24/7 INDUSTRIAL BREAKDOWN SERVICE", fs=27)}'
    )
    return frame(inner)


# ----------------------------------------------------------------------------
# 03 — Commercial
# ----------------------------------------------------------------------------
def ad_commercial():
    left  = ["Switchboards & lighting", "Data cabling — phone/POS/PC",
             "CCTV & security systems", "Fault diagnostics & repairs"]
    right = ["Power & machinery wiring", "Fibre optic infrastructure",
             "Facility maintenance", "Emergency fault response"]
    inner = (
        f'{chrome()}'
        f'{ghost(600, 340, "OPEN", fs=250, op=0.08)}'
        f'{halftone(70, 620, 6, 8, gap=26, r0=4.2, op=0.12)}'
        f'{logo(64, 64, s=0.9)}'
        f'{kicker(64, 216, "COMMERCIAL DIVISION")}'
        f'<text x="60" y="316" font-family="{FONT}" font-size="80" font-weight="bold" fill="{WHITE}">FIT-OUTS. REPAIRS.</text>'
        f'<text x="62" y="400" font-family="{FONT}" font-size="80" font-weight="bold" fill="none" '
        f'stroke="{RED}" stroke-width="3">MAINTENANCE.</text>'
        f'<text x="64" y="458" font-family="{FONT_M}" font-size="22" letter-spacing="2" fill="{MIST}">'
        f'FAST, RELIABLE SERVICE THAT KEEPS YOUR DOORS OPEN</text>'
        f'{bus_list(80, 556, left, step=68, fs=25)}'
        f'{bus_list(600, 556, right, step=68, fs=25)}'
        f'{cta_pill(64, 858, "BOOK A COMMERCIAL JOB — FREE QUOTE", fs=27)}'
    )
    return frame(inner)


# ----------------------------------------------------------------------------
# 04 — Compliance
# ----------------------------------------------------------------------------
def ad_compliance():
    items = ["RCD (safety switch) testing & install", "Test & Tag of equipment",
             "Emergency light testing", "Switchboard thermal imaging",
             "Electrical auditing & compliance checks"]
    rows = []
    for i, t in enumerate(items):
        y = 548 + i * 64
        rows.append(
            f'<text x="72" y="{y}" font-family="{FONT_M}" font-size="20" font-weight="bold" '
            f'fill="{RED}">T-{i+1:02d}</text>'
            f'<text x="148" y="{y}" font-family="{FONT}" font-size="26" fill="{WHITE}">{esc(t)}</text>'
            f'<line x1="72" y1="{y+18}" x2="704" y2="{y+18}" stroke="{LINE}" stroke-width="1.5" opacity="0.7"/>'
        )
    inner = (
        f'{chrome()}'
        f'{ghost(620, 330, "SAFE", fs=250, op=0.08)}'
        f'{logo(64, 64, s=0.9)}'
        f'{kicker(64, 216, "COMPLIANCE & SAFETY")}'
        f'<text x="60" y="316" font-family="{FONT}" font-size="84" font-weight="bold" fill="{WHITE}">STAY SAFE.</text>'
        f'<text x="60" y="400" font-family="{FONT}" font-size="84" font-weight="bold" fill="{RED}">STAY COMPLIANT.</text>'
        f'<text x="64" y="458" font-family="{FONT_M}" font-size="22" letter-spacing="2" fill="{MIST}">'
        f'AUDIT-READY TO CURRENT AUSTRALIAN STANDARDS</text>'
        f'{"".join(rows)}'
        f'{stamp(866, 680, rot=-12, r=148)}'
        f'{iso_chip(64, 856, "ISO 9001:2018")}'
        f'{iso_chip(304, 856, "ISO 45001:2018", w=232)}'
    )
    return frame(inner)


# ----------------------------------------------------------------------------
# 05 — Industries served
# ----------------------------------------------------------------------------
def comp_chip(x, y, text, fs=27):
    w = len(text) * fs * 0.64 + 64
    h = fs + 36
    svg = (
        f'<g><rect x="{x}" y="{y}" width="{w:.0f}" height="{h}" rx="9" fill="{PANEL}" '
        f'stroke="{LINE}" stroke-width="2"/>'
        f'<circle cx="{x}" cy="{y+h/2}" r="5" fill="{RED}"/>'
        f'<circle cx="{x+w:.0f}" cy="{y+h/2}" r="5" fill="{RED}"/>'
        f'<text x="{x+w/2:.0f}" y="{y+h/2+fs*0.35:.0f}" text-anchor="middle" font-family="{FONT}" '
        f'font-size="{fs}" font-weight="bold" letter-spacing="1" fill="{WHITE}">{esc(text)}</text></g>'
    )
    return svg, w


def ad_industries():
    items = ["RETAIL STORES", "WORKSHOPS", "WAREHOUSES", "OFFICES",
             "HOSPITALITY", "AGRICULTURE", "INDUSTRIAL PLANTS", "EDUCATION"]
    chips, x, y = [], 64, 560
    for t in items:
        _, w = comp_chip(0, 0, t)
        if x + w > 1016 and x > 64:
            x = 64
            y += 27 + 36 + 30
        svg, w = comp_chip(x, y, t)
        chips.append(svg)
        x += w + 26
    inner = (
        f'{chrome()}'
        f'{ghost(520, 350, "LOCAL", fs=240, op=0.08)}'
        f'{halftone(830, 700, 7, 8, gap=27, r0=4.6, op=0.14)}'
        f'{logo(64, 64, s=0.9)}'
        f'{kicker(64, 216, "WHO WE WORK WITH")}'
        f'<text x="60" y="322" font-family="{FONT}" font-size="78" font-weight="bold" fill="{WHITE}">TRUSTED ACROSS</text>'
        f'<text x="60" y="404" font-family="{FONT}" font-size="78" font-weight="bold" fill="{RED}">THE CENTRAL WEST</text>'
        f'<text x="64" y="462" font-family="{FONT_M}" font-size="21" letter-spacing="1.5" fill="{MIST}">'
        f'FROM THE FACTORY FLOOR TO THE SHOPFRONT — WE POWER THEM ALL</text>'
        f'{"".join(chips)}'
        f'{pulse(64, 902, 420)}'
        f'{dim_line(560, 1016, 902, "SERVICE AREA: CENTRAL WEST")}'
    )
    return frame(inner)


# ----------------------------------------------------------------------------
# 06 — Why choose us
# ----------------------------------------------------------------------------
def stat_card(x, y, big, small, note, w=296, h=186):
    b = 26
    return (
        f'<g><rect x="{x}" y="{y}" width="{w}" height="{h}" rx="12" fill="{PANEL}" '
        f'stroke="{LINE}" stroke-width="1.5"/>'
        f'<path d="M{x+10},{y+10+b} V{y+10} H{x+10+b}" fill="none" stroke="{RED}" stroke-width="4"/>'
        f'<path d="M{x+w-10-b},{y+h-10} H{x+w-10} V{y+h-10-b}" fill="none" stroke="{RED}" stroke-width="4"/>'
        f'<text x="{x+w/2}" y="{y+88}" text-anchor="middle" font-family="{FONT}" font-size="62" '
        f'font-weight="bold" fill="{RED}">{esc(big)}</text>'
        f'<text x="{x+w/2}" y="{y+126}" text-anchor="middle" font-family="{FONT_M}" font-size="19" '
        f'font-weight="bold" letter-spacing="2" fill="{WHITE}">{esc(small)}</text>'
        f'<text x="{x+w/2}" y="{y+158}" text-anchor="middle" font-family="{FONT_M}" font-size="14" '
        f'letter-spacing="1" fill="{MIST}">{esc(note)}</text></g>'
    )


def ad_why():
    checks = ["Locally owned & operated", "Fast, reliable & professional",
              "Free quotes, no obligation", "24/7 industrial breakdown support",
              "Quality assurance on every job"]
    inner = (
        f'{chrome()}'
        f'{ghost(500, 330, "TRUST", fs=240, op=0.08)}'
        f'{logo(64, 64, s=0.9)}'
        f'{kicker(64, 216, "THE WEILEY DIFFERENCE")}'
        f'<text x="60" y="308" font-family="{FONT}" font-size="72" font-weight="bold" fill="{WHITE}">WHY CHOOSE</text>'
        f'<text x="60" y="384" font-family="{FONT}" font-size="72" font-weight="bold" fill="{RED}">WEILEY ELECTRICAL?</text>'
        f'{stat_card(64, 430, "40+", "YEARS EXPERIENCE", "HANDS-ON SINCE DAY ONE")}'
        f'{stat_card(392, 430, "1986", "ESTABLISHED", "LOCALLY OWNED • DUBBO")}'
        f'{stat_card(720, 430, "ISO ×2", "CERTIFIED", "9001:2018 • 45001:2018")}'
        f'{bus_list(80, 692, checks, step=56, fs=27)}'
    )
    return frame(inner)


# ----------------------------------------------------------------------------
# 07 — Free quote / contact
# ----------------------------------------------------------------------------
def ad_quote():
    tx, ty, tw, th = 64, 176, 952, 420   # ticket
    contact_rows = [
        ("CALL",  PHONE, 52, RED,   True),
        ("EMAIL", EMAIL, 30, WHITE, False),
        ("VISIT", ADDR,  26, WHITE, False),
        ("HOURS", HOURS, 26, WHITE, False),
    ]
    rows = []
    y = 700
    for label, val, fs, col, big in contact_rows:
        weight = 'font-weight="bold" ' if big else ''
        rows.append(
            f'<text x="80" y="{y}" font-family="{FONT_M}" font-size="19" font-weight="bold" '
            f'letter-spacing="2" fill="{RED}">{esc(label)}</text>'
            f'<text x="220" y="{y + (8 if big else 0)}" font-family="{FONT}" font-size="{fs}" '
            f'{weight}fill="{col}">{esc(val)}</text>'
        )
        y += 78 if big else 54
    inner = (
        f'{chrome()}'
        f'{logo(64, 64, s=0.9)}'
        # ticket / voucher
        f'<rect x="{tx}" y="{ty}" width="{tw}" height="{th}" rx="18" fill="{PANEL}" '
        f'stroke="{MIST}" stroke-width="2.5" stroke-dasharray="10 8"/>'
        f'<circle cx="{tx}" cy="{ty+th/2}" r="26" fill="{INK}" stroke="{MIST}" stroke-width="2.5" stroke-dasharray="8 7"/>'
        f'<circle cx="{tx+tw}" cy="{ty+th/2}" r="26" fill="{INK}" stroke="{MIST}" stroke-width="2.5" stroke-dasharray="8 7"/>'
        f'<text x="{tx+44}" y="{ty+58}" font-family="{FONT_M}" font-size="19" letter-spacing="3" '
        f'fill="{MIST}">FREE QUOTE VOUCHER — NO EXPIRY — NO OBLIGATION</text>'
        f'{glow(tx+310, ty+220, 260, "gRed", 0.55)}'
        f'<text x="{tx+40}" y="{ty+256}" font-family="{FONT}" font-size="172" font-weight="bold" fill="{WHITE}">FREE</text>'
        f'<text x="{tx+44}" y="{ty+356}" font-family="{FONT}" font-size="92" font-weight="bold" fill="{RED}">QUOTES</text>'
        f'<text x="{tx+44}" y="{ty+396}" font-family="{FONT_M}" font-size="20" letter-spacing="2" '
        f'fill="{MIST}">COMMERCIAL &amp; INDUSTRIAL ELECTRICAL</text>'
        # mini stamp overlapping ticket corner
        f'<g transform="translate(866,300) rotate(12)">'
        f'<circle cx="0" cy="0" r="86" fill="none" stroke="{RED}" stroke-width="4"/>'
        f'<circle cx="0" cy="0" r="66" fill="none" stroke="{RED}" stroke-width="1.5"/>'
        f'<text x="0" y="-12" text-anchor="middle" font-family="{FONT}" font-size="30" font-weight="bold" fill="{RED}">$0</text>'
        f'<text x="0" y="22" text-anchor="middle" font-family="{FONT_M}" font-size="15" font-weight="bold" '
        f'letter-spacing="1" fill="{RED}">TO QUOTE</text></g>'
        f'{"".join(rows)}'
        f'{pulse(680, 686, 330)}'
    )
    return frame(inner)


# ----------------------------------------------------------------------------
ADS = {
    "01_hero_powered":       ad_hero,
    "02_industrial":         ad_industrial,
    "03_commercial":         ad_commercial,
    "04_compliance":         ad_compliance,
    "05_industries_served":  ad_industries,
    "06_why_choose_us":      ad_why,
    "07_free_quote_contact": ad_quote,
}


def main():
    for name, fn in ADS.items():
        svg = fn()
        with open(os.path.join(OUT, name + ".svg"), "w") as f:
            f.write(svg)
        cairosvg.svg2png(bytestring=svg.encode(),
                         write_to=os.path.join(OUT, name + ".png"),
                         output_width=SIZE, output_height=SIZE)
        print("wrote", name + ".png")


if __name__ == "__main__":
    main()
