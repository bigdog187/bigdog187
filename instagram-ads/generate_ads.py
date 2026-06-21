#!/usr/bin/env python3
"""
Instagram ad generator for Weiley Electrical (wyelec.com.au).

Produces a full set of 1080x1080 PNG ad creatives (plus source SVGs), built
exhaustively from the company's website content across every page:
home, about, industrial, commercial, compliance and contact.

Run:  python3 generate_ads.py
"""

import os
import html
import cairosvg

# ----------------------------------------------------------------------------
# Brand system
# ----------------------------------------------------------------------------
NAVY      = "#0B2138"   # deep brand navy
NAVY_2    = "#102B49"   # lighter navy for gradient
NAVY_3    = "#0A1B2E"   # near-black navy
AMBER     = "#FFC21A"   # electric amber / yellow accent
AMBER_2   = "#FFD24D"
WHITE     = "#FFFFFF"
MIST      = "#C9D6E5"   # muted blue-grey text
LINE      = "#1C3A5C"   # subtle circuit line colour

FONT = "DejaVu Sans, Liberation Sans, sans-serif"

SIZE = 1080
OUT  = os.path.dirname(os.path.abspath(__file__))


def esc(s):
    return html.escape(str(s), quote=True)


# ----------------------------------------------------------------------------
# Reusable SVG pieces
# ----------------------------------------------------------------------------
def bolt(cx, cy, scale=1.0, fill=AMBER, opacity=1.0):
    """A lightning-bolt mark centred roughly on (cx, cy)."""
    return (
        f'<g transform="translate({cx},{cy}) scale({scale}) translate(-50,-75)">'
        f'<path d="M58,4 L20,84 L46,84 L32,146 L92,60 L60,60 Z" '
        f'fill="{fill}" opacity="{opacity}"/></g>'
    )


def circuit_bg(seed_lines):
    parts = []
    for d in seed_lines:
        parts.append(f'<path d="{d}" fill="none" stroke="{LINE}" stroke-width="3"/>')
    return "".join(parts)


def logo_lockup(x, y, scale=1.0, on_dark=True):
    """Weiley Electrical wordmark with bolt badge. Anchored top-left at (x,y)."""
    txt = WHITE if on_dark else NAVY
    sub = AMBER if on_dark else NAVY
    s = scale
    badge = (
        f'<g transform="translate({x},{y})">'
        f'<rect x="0" y="0" width="{72*s}" height="{72*s}" rx="{16*s}" fill="{AMBER}"/>'
        f'{bolt(36*s, 36*s, scale=0.42*s, fill=NAVY)}'
        f'</g>'
    )
    words = (
        f'<g transform="translate({x + 88*s},{y})">'
        f'<text x="0" y="{30*s}" font-family="{FONT}" font-size="{30*s}" '
        f'font-weight="bold" letter-spacing="{1.5*s}" fill="{txt}">WEILEY</text>'
        f'<text x="0" y="{62*s}" font-family="{FONT}" font-size="{20*s}" '
        f'font-weight="bold" letter-spacing="{7.6*s}" fill="{sub}">ELECTRICAL</text>'
        f'</g>'
    )
    return badge + words


def footer(line=None, phone="02 6884 9292"):
    line = line or "wyelec.com.au"
    y = 1012
    return (
        f'<rect x="0" y="980" width="{SIZE}" height="100" fill="{NAVY_3}"/>'
        f'<rect x="0" y="980" width="{SIZE}" height="4" fill="{AMBER}"/>'
        f'<text x="64" y="{y+18}" font-family="{FONT}" font-size="30" font-weight="bold" '
        f'fill="{WHITE}">{esc(line)}</text>'
        f'<text x="{SIZE-64}" y="{y+18}" text-anchor="end" font-family="{FONT}" '
        f'font-size="30" font-weight="bold" fill="{AMBER}">{esc(phone)}</text>'
    )


def defs():
    return (
        '<defs>'
        f'<linearGradient id="navy" x1="0" y1="0" x2="1" y2="1">'
        f'<stop offset="0" stop-color="{NAVY_2}"/><stop offset="1" stop-color="{NAVY_3}"/>'
        f'</linearGradient>'
        f'<linearGradient id="amber" x1="0" y1="0" x2="1" y2="1">'
        f'<stop offset="0" stop-color="{AMBER_2}"/><stop offset="1" stop-color="{AMBER}"/>'
        f'</linearGradient>'
        '</defs>'
    )


def frame(inner):
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{SIZE}" height="{SIZE}" '
        f'viewBox="0 0 {SIZE} {SIZE}">{defs()}{inner}</svg>'
    )


def pill(x, y, text, fill=AMBER, txt=NAVY, fs=24, pad=26):
    w = len(text) * fs * 0.66 + len(text) * 1.6 + pad * 2
    return (
        f'<g><rect x="{x}" y="{y}" width="{w:.0f}" height="{fs+pad}" rx="{(fs+pad)/2}" '
        f'fill="{fill}"/>'
        f'<text x="{x+w/2:.0f}" y="{y+(fs+pad)/2+fs*0.34:.0f}" text-anchor="middle" '
        f'font-family="{FONT}" font-size="{fs}" font-weight="bold" letter-spacing="1.5" '
        f'fill="{txt}">{esc(text)}</text></g>'
    )


def check_row(x, y, text, fs=30, r=18):
    return (
        f'<circle cx="{x+r-2}" cy="{y-8}" r="{r}" fill="{AMBER}"/>'
        f'<path d="M{x+r-10},{y-8} l6,7 l12,-15" fill="none" stroke="{NAVY}" '
        f'stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/>'
        f'<text x="{x+r+18}" y="{y+2}" font-family="{FONT}" font-size="{fs}" '
        f'fill="{WHITE}">{esc(text)}</text>'
    )


def chip(x, y, text, fs=30):
    w = len(text) * fs * 0.60 + 56
    svg = (
        f'<g><rect x="{x}" y="{y}" width="{w:.0f}" height="{fs+30}" rx="{(fs+30)/2}" '
        f'fill="none" stroke="{AMBER}" stroke-width="2"/>'
        f'<text x="{x+w/2:.0f}" y="{y+(fs+30)/2+fs*0.34:.0f}" text-anchor="middle" '
        f'font-family="{FONT}" font-size="{fs}" font-weight="bold" fill="{WHITE}">'
        f'{esc(text)}</text></g>'
    )
    return svg, w


def chip_cloud(items, x0=64, y0=440, x_max=1016, fs=30, gap=18, vgap=20):
    out, x, y = [], x0, y0
    for t in items:
        _, w = chip(0, 0, t, fs)
        if x + w > x_max and x > x0:
            x = x0
            y += fs + 30 + vgap
        svg, w = chip(x, y, t, fs)
        out.append(svg)
        x += w + gap
    return "".join(out)


def kicker(x, y, text, fs=24):
    return pill(x, y, text, fs=fs)


# ----------------------------------------------------------------------------
# 01 — Brand / hero
# ----------------------------------------------------------------------------
def ad_hero():
    traces = ["M0,300 H180 V200", "M180,200 H320", "M0,760 H140 V860",
              "M1080,420 H940 V520", "M1080,700 H880"]
    inner = (
        f'<rect width="{SIZE}" height="{SIZE}" fill="url(#navy)"/>'
        f'{circuit_bg(traces)}'
        f'{bolt(835, 560, scale=5.4, fill=AMBER, opacity=0.10)}'
        f'{bolt(835, 560, scale=4.0, fill=AMBER, opacity=1.0)}'
        f'{logo_lockup(64, 70, scale=1.18)}'
        f'<g transform="translate(64,250)">'
        f'<rect x="0" y="0" width="250" height="46" rx="23" fill="none" stroke="{AMBER}" stroke-width="2"/>'
        f'<text x="125" y="31" text-anchor="middle" font-family="{FONT}" font-size="22" '
        f'font-weight="bold" letter-spacing="2" fill="{AMBER}">EST. 1986  &#8226;  40+ YEARS</text></g>'
        f'<text x="64" y="430" font-family="{FONT}" font-size="78" font-weight="bold" fill="{WHITE}">KEEPING</text>'
        f'<text x="64" y="512" font-family="{FONT}" font-size="78" font-weight="bold" fill="{WHITE}">CENTRAL WEST</text>'
        f'<text x="64" y="594" font-family="{FONT}" font-size="78" font-weight="bold" fill="{AMBER}">BUSINESSES</text>'
        f'<text x="64" y="676" font-family="{FONT}" font-size="78" font-weight="bold" fill="{AMBER}">POWERED</text>'
        f'<text x="66" y="748" font-family="{FONT}" font-size="30" fill="{MIST}">'
        f'Industrial &#8226; Commercial &#8226; Compliance</text>'
        f'<text x="66" y="794" font-family="{FONT}" font-size="30" fill="{MIST}">'
        f'Locally owned &amp; operated &#8212; Dubbo &amp; Central West NSW</text>'
        f'<text x="66" y="840" font-family="{FONT}" font-size="30" fill="{MIST}">'
        f'ISO 9001 &amp; 45001 certified &#8226; Free quotes</text>'
        f'{footer()}'
    )
    return frame(inner)


# ----------------------------------------------------------------------------
# 02 — Industrial (detailed)
# ----------------------------------------------------------------------------
def ad_industrial():
    col1, col2 = 72, 600
    inner = (
        f'<rect width="{SIZE}" height="{SIZE}" fill="url(#navy)"/>'
        f'<path d="M0,0 L1080,0 L1080,250 L0,310 Z" fill="url(#amber)"/>'
        f'<path d="M0,310 L1080,250 L1080,262 L0,322 Z" fill="{NAVY_3}" opacity="0.25"/>'
        f'{bolt(915, 150, scale=2.0, fill=NAVY, opacity=0.14)}'
        f'{logo_lockup(64, 56, scale=1.0, on_dark=False)}'
        f'<text x="64" y="232" font-family="{FONT}" font-size="50" font-weight="bold" fill="{NAVY}">INDUSTRIAL ELECTRICAL</text>'
        f'<text x="66" y="380" font-family="{FONT}" font-size="30" font-weight="bold" fill="{AMBER}">Four decades keeping plants &amp; machinery running</text>'
        f'{check_row(col1, 470, "PLC, SCADA & HMI systems", fs=25)}'
        f'{check_row(col2, 470, "Control panel design & build", fs=25)}'
        f'{check_row(col1, 540, "Machinery wiring & automation", fs=25)}'
        f'{check_row(col2, 540, "Hazardous area electrical", fs=25)}'
        f'{check_row(col1, 610, "Instrumentation & controls", fs=25)}'
        f'{check_row(col2, 610, "Pump control & diagnostics", fs=25)}'
        f'{check_row(col1, 680, "Telemetry & remote monitoring", fs=25)}'
        f'{check_row(col2, 680, "Fault finding & repairs", fs=25)}'
        f'{check_row(col1, 750, "New installs & upgrades", fs=25)}'
        f'{check_row(col2, 750, "Preventive plant maintenance", fs=25)}'
        f'{pill(72, 858, "24/7 INDUSTRIAL BREAKDOWN SERVICE", fs=27)}'
        f'{footer()}'
    )
    return frame(inner)


# ----------------------------------------------------------------------------
# 03 — Commercial (detailed)
# ----------------------------------------------------------------------------
def ad_commercial():
    col1, col2 = 72, 600
    inner = (
        f'<rect width="{SIZE}" height="{SIZE}" fill="url(#navy)"/>'
        f'<rect x="0" y="0" width="{SIZE}" height="22" fill="{AMBER}"/>'
        f'{bolt(890, 760, scale=4.4, fill=AMBER, opacity=0.08)}'
        f'{logo_lockup(64, 70, scale=1.0)}'
        f'{kicker(64, 200, "COMMERCIAL ELECTRICAL", fs=24)}'
        f'<text x="64" y="320" font-family="{FONT}" font-size="58" font-weight="bold" fill="{WHITE}">Fit-outs, repairs &amp;</text>'
        f'<text x="64" y="386" font-family="{FONT}" font-size="58" font-weight="bold" fill="{AMBER}">maintenance</text>'
        f'<text x="66" y="442" font-family="{FONT}" font-size="28" fill="{MIST}">Fast, reliable service that keeps your doors open.</text>'
        f'{check_row(col1, 540, "Switchboards & lighting", fs=25)}'
        f'{check_row(col2, 540, "Power & machinery wiring", fs=25)}'
        f'{check_row(col1, 610, "Data cabling — phone/POS/PC", fs=25)}'
        f'{check_row(col2, 610, "Fibre optic infrastructure", fs=25)}'
        f'{check_row(col1, 680, "CCTV & security systems", fs=25)}'
        f'{check_row(col2, 680, "Facility maintenance", fs=25)}'
        f'{check_row(col1, 750, "Fault diagnostics & repairs", fs=25)}'
        f'{check_row(col2, 750, "Emergency fault response", fs=25)}'
        f'{pill(72, 858, "BOOK A COMMERCIAL JOB", fs=27)}'
        f'{footer()}'
    )
    return frame(inner)


# ----------------------------------------------------------------------------
# 04 — Compliance / safety (detailed)
# ----------------------------------------------------------------------------
def ad_compliance():
    inner = (
        f'<rect width="{SIZE}" height="{SIZE}" fill="url(#navy)"/>'
        f'<rect x="0" y="0" width="22" height="{SIZE}" fill="{AMBER}"/>'
        f'{bolt(880, 720, scale=4.6, fill=AMBER, opacity=0.08)}'
        f'{logo_lockup(64, 70, scale=1.0)}'
        f'{kicker(64, 200, "COMPLIANCE & SAFETY", fs=24)}'
        f'<text x="64" y="332" font-family="{FONT}" font-size="70" font-weight="bold" fill="{WHITE}">STAY SAFE.</text>'
        f'<text x="64" y="410" font-family="{FONT}" font-size="70" font-weight="bold" fill="{AMBER}">STAY COMPLIANT.</text>'
        f'<text x="66" y="466" font-family="{FONT}" font-size="28" fill="{MIST}">Audit-ready to current Australian standards.</text>'
        f'{check_row(72, 548, "RCD (safety switch) testing & install", fs=29)}'
        f'{check_row(72, 610, "Test & Tag of equipment", fs=29)}'
        f'{check_row(72, 672, "Emergency light testing", fs=29)}'
        f'{check_row(72, 734, "Switchboard thermal imaging", fs=29)}'
        f'{check_row(72, 796, "Electrical auditing & compliance checks", fs=29)}'
        f'<g transform="translate(64,838)">'
        f'<rect x="0" y="0" width="210" height="48" rx="10" fill="none" stroke="{MIST}" stroke-width="2"/>'
        f'<text x="105" y="31" text-anchor="middle" font-family="{FONT}" font-size="20" font-weight="bold" fill="{MIST}">ISO 9001:2018</text>'
        f'<rect x="226" y="0" width="210" height="48" rx="10" fill="none" stroke="{MIST}" stroke-width="2"/>'
        f'<text x="331" y="31" text-anchor="middle" font-family="{FONT}" font-size="20" font-weight="bold" fill="{MIST}">ISO 45001:2018</text>'
        f'</g>'
        f'{footer()}'
    )
    return frame(inner)


# ----------------------------------------------------------------------------
# 05 — Industries served
# ----------------------------------------------------------------------------
def ad_industries():
    items = ["Retail stores", "Workshops", "Warehouses", "Offices",
             "Hospitality", "Agriculture", "Industrial plants", "Education"]
    inner = (
        f'<rect width="{SIZE}" height="{SIZE}" fill="url(#navy)"/>'
        f'{bolt(150, 880, scale=4.2, fill=AMBER, opacity=0.07)}'
        f'{logo_lockup(64, 70, scale=1.0)}'
        f'{kicker(64, 200, "WHO WE WORK WITH", fs=24)}'
        f'<text x="64" y="332" font-family="{FONT}" font-size="66" font-weight="bold" fill="{WHITE}">Trusted across the</text>'
        f'<text x="64" y="406" font-family="{FONT}" font-size="66" font-weight="bold" fill="{AMBER}">Central West</text>'
        f'<text x="66" y="462" font-family="{FONT}" font-size="28" fill="{MIST}">From the factory floor to the shopfront &#8212; we power them all.</text>'
        f'{chip_cloud(items, x0=64, y0=540, x_max=1016, fs=32, gap=20, vgap=24)}'
        f'{footer()}'
    )
    return frame(inner)


# ----------------------------------------------------------------------------
# 06 — Why choose us
# ----------------------------------------------------------------------------
def stat_card(x, y, big, small, w=296):
    return (
        f'<g><rect x="{x}" y="{y}" width="{w}" height="150" rx="18" fill="{NAVY_3}"/>'
        f'<rect x="{x}" y="{y}" width="{w}" height="6" rx="3" fill="{AMBER}"/>'
        f'<text x="{x+w/2:.0f}" y="{y+86}" text-anchor="middle" font-family="{FONT}" '
        f'font-size="58" font-weight="bold" fill="{AMBER}">{esc(big)}</text>'
        f'<text x="{x+w/2:.0f}" y="{y+124}" text-anchor="middle" font-family="{FONT}" '
        f'font-size="22" font-weight="bold" letter-spacing="1" fill="{WHITE}">{esc(small)}</text></g>'
    )


def ad_why():
    inner = (
        f'<rect width="{SIZE}" height="{SIZE}" fill="url(#navy)"/>'
        f'{bolt(900, 250, scale=3.0, fill=AMBER, opacity=0.07)}'
        f'{logo_lockup(64, 70, scale=1.0)}'
        f'<text x="64" y="250" font-family="{FONT}" font-size="64" font-weight="bold" fill="{WHITE}">WHY CHOOSE</text>'
        f'<text x="64" y="320" font-family="{FONT}" font-size="64" font-weight="bold" fill="{AMBER}">WEILEY ELECTRICAL?</text>'
        f'{stat_card(64, 372, "40+", "YEARS EXPERIENCE")}'
        f'{stat_card(392, 372, "1986", "ESTABLISHED")}'
        f'{stat_card(720, 372, "ISO", "9001 & 45001")}'
        f'{check_row(72, 612, "Locally owned & operated", fs=29)}'
        f'{check_row(72, 674, "Fast, reliable & professional", fs=29)}'
        f'{check_row(72, 736, "Free quotes, no obligation", fs=29)}'
        f'{check_row(72, 798, "24/7 industrial breakdown support", fs=29)}'
        f'{check_row(72, 860, "Quality assurance on every job", fs=29)}'
        f'{footer()}'
    )
    return frame(inner)


# ----------------------------------------------------------------------------
# 07 — Free quote / contact CTA
# ----------------------------------------------------------------------------
def ad_quote():
    inner = (
        f'<rect width="{SIZE}" height="{SIZE}" fill="url(#amber)"/>'
        f'<path d="M0,560 L1080,470 L1080,1080 L0,1080 Z" fill="url(#navy)"/>'
        f'{bolt(190, 250, scale=2.2, fill=NAVY, opacity=0.13)}'
        f'{bolt(900, 800, scale=3.2, fill=AMBER, opacity=0.10)}'
        f'{logo_lockup(64, 64, scale=1.05, on_dark=False)}'
        f'<text x="64" y="290" font-family="{FONT}" font-size="38" font-weight="bold" fill="{NAVY}">COMMERCIAL &amp; INDUSTRIAL ELECTRICAL</text>'
        f'<text x="60" y="430" font-family="{FONT}" font-size="150" font-weight="bold" fill="{NAVY}">FREE</text>'
        f'<text x="60" y="520" font-family="{FONT}" font-size="78" font-weight="bold" fill="{NAVY}">QUOTES</text>'
        # contact block on navy
        f'<text x="64" y="640" font-family="{FONT}" font-size="34" font-weight="bold" fill="{WHITE}">Call our Dubbo team today</text>'
        f'<text x="60" y="712" font-family="{FONT}" font-size="60" font-weight="bold" fill="{AMBER}">02 6884 9292</text>'
        f'<text x="64" y="772" font-family="{FONT}" font-size="28" fill="{MIST}">service@wyelec.com.au</text>'
        f'<text x="64" y="814" font-family="{FONT}" font-size="28" fill="{MIST}">Unit 9B, 55 Wheelers Lane, Dubbo NSW 2830</text>'
        f'<text x="64" y="856" font-family="{FONT}" font-size="28" fill="{MIST}">Mon&#8211;Fri 7:30am&#8211;4pm &#8226; 24/7 industrial breakdown</text>'
        f'{footer()}'
    )
    return frame(inner)


# ----------------------------------------------------------------------------
ADS = {
    "01_hero_powered":      ad_hero,
    "02_industrial":        ad_industrial,
    "03_commercial":        ad_commercial,
    "04_compliance":        ad_compliance,
    "05_industries_served": ad_industries,
    "06_why_choose_us":     ad_why,
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
