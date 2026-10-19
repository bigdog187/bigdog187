#!/usr/bin/env python3
"""
Photo-led specialty ads for Weiley Electrical — extends the v2 "Schematic" set.

Uses real work photos (photos/) graded into the red / white / blue palette:
 - blue duotone that keeps true reds in colour (logos, red wiring)
 - FLIR thermal image re-mapped from ironbow into a blue -> red -> white
   palette using the camera's own temperature scale bar, so the reading
   is unchanged — only the colours are.
 - the brand ute photo stays natural (it is already red / white / blue)

Run:  python3 generate_photo_ads.py
"""

import os
import io
import base64

import cairosvg
import numpy as np
from PIL import Image, ImageFilter, ImageOps

import generate_ads as g
from generate_ads import (INK, BLUE, PANEL, BLUE_L, LINE, RED, WHITE, MIST,
                          FONT, FONT_M, SIZE, esc)

HERE   = os.path.dirname(os.path.abspath(__file__))
PHOTOS = os.path.join(HERE, "photos")


# ----------------------------------------------------------------------------
# Image processing
# ----------------------------------------------------------------------------
def hexrgb(h):
    h = h.lstrip("#")
    return np.array([int(h[i:i + 2], 16) for i in (0, 2, 4)], float)


def grad_lut(stops):
    lut = np.zeros((256, 3))
    for i in range(256):
        t = i / 255
        for (t0, c0), (t1, c1) in zip(stops, stops[1:]):
            if t0 <= t <= t1:
                u = (t - t0) / (t1 - t0)
                lut[i] = hexrgb(c0) * (1 - u) + hexrgb(c1) * u
                break
    return lut.astype(np.uint8)


DUO = grad_lut([(0, "#04101F"), (0.45, "#1B4A8C"), (0.8, "#9DB8E0"), (1, "#FFFFFF")])
THERMAL = grad_lut([(0, "#030B18"), (0.30, "#0E2F66"), (0.55, "#2B67C2"),
                    (0.72, "#E23636"), (0.88, "#FF6A4D"), (1, "#FFFFFF")])


def load(name):
    return ImageOps.exif_transpose(Image.open(os.path.join(PHOTOS, name))).convert("RGB")


def cover(im, w, h, cx=0.5, cy=0.5):
    """Scale to cover w x h, crop around (cx, cy) as fractions of the image."""
    s = max(w / im.width, h / im.height)
    im = im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)
    x = min(max(round(im.width * cx - w / 2), 0), im.width - w)
    y = min(max(round(im.height * cy - h / 2), 0), im.height - h)
    return im.crop((x, y, x + w, y + h))


def duo_red(im):
    """Blue duotone, keeping saturated reds in colour."""
    g_ = np.array(ImageOps.autocontrast(im.convert("L"), cutoff=1))
    duo = DUO[g_].astype(float)
    hsv = np.array(im.convert("HSV")).astype(float)
    h, s, v = hsv[..., 0], hsv[..., 1], hsv[..., 2]
    red = ((h < 9) | (h > 238)) & (s > 110) & (v > 70)
    m = Image.fromarray((red * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.2))
    m = (np.array(m).astype(float) / 255)[..., None]
    out = duo * (1 - m) + np.array(im).astype(float) * m
    return Image.fromarray(out.clip(0, 255).astype(np.uint8))


def thermal_rwb(name):
    """Re-map a FLIR ironbow image to the brand thermal palette via its scale bar."""
    th = np.array(Image.open(os.path.join(PHOTOS, name)).convert("RGB")).astype(float)
    bar = th[4:536, 742:752].mean(axis=1)            # hot (top) -> cold (bottom)
    temp = np.linspace(1, 0, len(bar))
    img = th[:, :718]                                 # drop the scale-bar strip
    flat = img.reshape(-1, 3)
    t = np.empty(len(flat))
    for i in range(0, len(flat), 20000):
        f = flat[i:i + 20000]
        t[i:i + 20000] = temp[((f[:, None, :] - bar[None]) ** 2).sum(-1).argmin(1)]
    out = THERMAL[(t * 255).astype(int)].reshape(img.shape).astype(np.uint8)
    return Image.fromarray(out)


def data_uri(im, fmt="JPEG"):
    buf = io.BytesIO()
    if fmt == "JPEG":
        im.convert("RGB").save(buf, "JPEG", quality=90)
        mime = "image/jpeg"
    else:
        im.save(buf, "PNG")
        mime = "image/png"
    return f"data:{mime};base64,{base64.b64encode(buf.getvalue()).decode()}"


def image(im, x, y, w, h, fmt="JPEG", op=1):
    return (f'<image x="{x}" y="{y}" width="{w}" height="{h}" opacity="{op}" '
            f'preserveAspectRatio="none" xlink:href="{data_uri(im, fmt)}"/>')


EYES  = "WE'VE GOT EYES ON IT."
THERE = "WE'LL BE THERE."

LOGO = Image.open(os.path.join(PHOTOS, "we_logo.png")).convert("RGBA")
_ink = np.array(LOGO)
_ys, _xs = np.where((_ink[..., 3] > 20) & (_ink[..., :3].min(-1) < 230))
LOGO = LOGO.crop((_xs.min() - 4, _ys.min() - 4, _xs.max() + 5, _ys.max() + 5))   # drop white padding


# ----------------------------------------------------------------------------
# SVG pieces
# ----------------------------------------------------------------------------
def extra_defs():
    return (
        '<defs>'
        f'<linearGradient id="fadeDown" x1="0" y1="0" x2="0" y2="1">'
        f'<stop offset="0" stop-color="{INK}" stop-opacity="0"/>'
        f'<stop offset="1" stop-color="{INK}" stop-opacity="1"/></linearGradient>'
        f'<linearGradient id="fadeUp" x1="0" y1="0" x2="0" y2="1">'
        f'<stop offset="0" stop-color="{INK}" stop-opacity="0.95"/>'
        f'<stop offset="1" stop-color="{INK}" stop-opacity="0"/></linearGradient>'
        f'<linearGradient id="thermBar" x1="0" y1="0" x2="0" y2="1">'
        f'<stop offset="0" stop-color="#FFFFFF"/><stop offset="0.12" stop-color="#FF6A4D"/>'
        f'<stop offset="0.28" stop-color="#E23636"/><stop offset="0.45" stop-color="#2B67C2"/>'
        f'<stop offset="0.7" stop-color="#0E2F66"/><stop offset="1" stop-color="#030B18"/>'
        f'</linearGradient>'
        '</defs>'
    )


def frame(inner):
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" '
        f'width="{SIZE}" height="{SIZE}" viewBox="0 0 {SIZE} {SIZE}">'
        f'{g.defs()}{extra_defs()}{inner}</svg>'
    )


def ground(grid=True):
    return (f'<rect width="{SIZE}" height="{SIZE}" fill="url(#ink)"/>'
            f'{g.grid() if grid else ""}')


def finish(crosshairs=True):
    ch = (f'{g.crosshair(40, 40)}{g.crosshair(1040, 40)}'
          f'{g.crosshair(40, 928)}{g.crosshair(1040, 928)}') if crosshairs else ""
    return ch + g.title_block()


def real_logo(x, y, s=1.0, plate=False):
    """Real WE monogram on a white tile + wordmark (plate = dark backing for busy photos)."""
    t = 76 * s
    lw = 58 * s
    lh = lw * LOGO.height / LOGO.width
    logo = LOGO.resize((int(lw * 3), int(lh * 3)), Image.LANCZOS)
    back = (f'<rect x="{x-12}" y="{y-12}" width="{t+262*s}" height="{t+24}" rx="{20*s}" '
            f'fill="{INK}" opacity="0.78"/>') if plate else ""
    return (
        back +
        f'<rect x="{x}" y="{y}" width="{t}" height="{t}" rx="{14*s}" fill="{WHITE}"/>'
        f'{image(logo, x + (t - lw) / 2, y + (t - lh) / 2, lw, lh, fmt="PNG")}'
        f'<text x="{x+t+18*s}" y="{y+34*s}" font-family="{FONT}" font-size="{31*s}" font-weight="bold" '
        f'letter-spacing="{2*s}" fill="{WHITE}">WEILEY</text>'
        f'<text x="{x+t+19*s}" y="{y+64*s}" font-family="{FONT_M}" font-size="{17*s}" font-weight="bold" '
        f'letter-spacing="{8.2*s}" fill="{RED}">ELECTRICAL</text>'
    )


def photo_frame(x, y, w, h, b=34):
    return (
        f'<rect x="{x}" y="{y}" width="{w}" height="{h}" fill="none" stroke="{LINE}" stroke-width="2"/>'
        f'<path d="M{x-8},{y-8+b} V{y-8} H{x-8+b}" fill="none" stroke="{RED}" stroke-width="4"/>'
        f'<path d="M{x+w+8-b},{y-8} H{x+w+8} V{y-8+b}" fill="none" stroke="{RED}" stroke-width="4"/>'
        f'<path d="M{x-8},{y+h+8-b} V{y+h+8} H{x-8+b}" fill="none" stroke="{RED}" stroke-width="4"/>'
        f'<path d="M{x+w+8-b},{y+h+8} H{x+w+8} V{y+h+8-b}" fill="none" stroke="{RED}" stroke-width="4"/>'
    )


def callout(px, py, lx, ly, text, side="right"):
    """Engineering callout: node on the photo, leader, mono label tag."""
    w = len(text) * 11.1 + 34
    bx = lx if side == "right" else lx - w
    tail = lx + 14 if side == "right" else lx - 14
    return (
        f'<polyline points="{px},{py} {lx},{ly}" fill="none" stroke="{WHITE}" stroke-width="2" opacity="0.9"/>'
        f'<circle cx="{px}" cy="{py}" r="13" fill="none" stroke="{RED}" stroke-width="2.5"/>'
        f'{g.node(px, py, r=6)}'
        f'<rect x="{bx:.0f}" y="{ly-16}" width="{w:.0f}" height="32" rx="4" fill="{INK}" opacity="0.92"/>'
        f'<rect x="{bx:.0f}" y="{ly-16}" width="5" height="32" fill="{RED}"/>'
        f'<text x="{bx+17:.0f}" y="{ly+6}" font-family="{FONT_M}" font-size="16" font-weight="bold" '
        f'letter-spacing="1.5" fill="{WHITE}">{esc(text)}</text>'
    )


def headline(x, y, text, fs, fill=WHITE):
    return (f'<text x="{x}" y="{y}" font-family="{FONT}" font-size="{fs}" '
            f'font-weight="bold" fill="{fill}">{esc(text)}</text>')


def mono(x, y, text, fs=21, fill=MIST, ls=2, anchor="start"):
    return (f'<text x="{x}" y="{y}" text-anchor="{anchor}" font-family="{FONT_M}" font-size="{fs}" '
            f'letter-spacing="{ls}" fill="{fill}">{esc(text)}</text>')


def bus_pair(y0, left, right, step=54, fs=24):
    return g.bus_list(80, y0, left, step=step, fs=fs) + g.bus_list(580, y0, right, step=step, fs=fs)


# ----------------------------------------------------------------------------
# 08 — PLC programming
# ----------------------------------------------------------------------------
def ad_plc():
    px, py, pw, ph = 548, 136, 472, 632
    photo = duo_red(cover(load("plc_rack.png"), pw, ph))
    s = pw / 598                                    # photo scale (source is 598 wide)
    items = ["PLC programming & upgrades", "Automation system design",
             "Control panel design & build", "Fault finding & repairs",
             "Installation & maintenance"]
    inner = (
        f'{ground()}'
        f'{g.glow(px + pw/2, py + ph/2, 420, "gRed", 0.35)}'
        f'{image(photo, px, py, pw, ph)}'
        f'{photo_frame(px, py, pw, ph)}'
        f'{callout(px + 300*s, py + 100*s, px + 150, py + 195, "PLC & I/O MODULES")}'
        f'{callout(px + 220*s, py + 268*s, px + 130, py + 300, "FIELD WIRING")}'
        f'{real_logo(64, 64, 0.9)}'
        f'{g.kicker(64, 232, "AUTOMATION")}'
        f'{headline(56, 416, "PLC", 196)}'
        f'{headline(62, 482, "PROGRAMMING", 50, RED)}'
        f'{headline(62, 530, "& CONTROL SYSTEMS", 33)}'
        f'{g.bus_list(80, 616, items, step=50, fs=23)}'
        f'{g.cta_pill(64, 878, "TALK TO OUR AUTOMATION TEAM", fs=24)}'
        f'{finish()}'
    )
    return frame(inner)


# ----------------------------------------------------------------------------
# 09 — HMI & SCADA
# ----------------------------------------------------------------------------
def ad_hmi():
    sw, sh = 560, 419                               # screen (4:3)
    bz = 24
    bx, by = 1020 - sw - 2 * bz, 486
    sx, sy = bx + bz, by + bz
    screen = cover(Image.open(os.path.join(PHOTOS, "hmi_tanks.png")).convert("RGB"), sw, sh)
    k = sw / 799                                    # screen scale (source is 799 wide)
    items = ["HMI screen design", "SCADA systems", "Remote monitoring",
             "Telemetry & alarms", "Upgrades & support"]
    inner = (
        f'{ground()}'
        f'{g.ghost(470, 420, "SCADA", fs=200, op=0.07)}'
        f'{g.glow(bx + sw/2 + bz, by + sh/2 + bz, 420, "gRed", 0.45)}'
        # touchscreen bezel
        f'<rect x="{bx}" y="{by}" width="{sw+2*bz}" height="{sh+2*bz}" rx="22" fill="#0A1222" '
        f'stroke="{BLUE_L}" stroke-width="2"/>'
        f'<rect x="{bx+6}" y="{by+6}" width="{sw+2*bz-12}" height="{sh+2*bz-12}" rx="17" fill="none" '
        f'stroke="#1E2C44" stroke-width="1.5"/>'
        f'{image(screen, sx, sy, sw, sh, fmt="PNG")}'
        f'<circle cx="{bx+sw/2+bz}" cy="{by+sh+2*bz-11}" r="4" fill="{RED}"/>'
        f'{callout(sx + 215*k, sy + 268*k, sx + 120, sy + 365, "LIVE TANK DATA")}'
        f'{callout(sx + 560*k, sy + 162*k, sx + 300, sy + 70, "VALVE STATUS", side="left")}'
        f'{callout(sx + 635*k, sy + 425*k, sx + 548, sy + 386, "PUMP CONTROL", side="left")}'
        f'{real_logo(64, 64, 0.9)}'
        f'{g.kicker(64, 232, "HMI & SCADA")}'
        f'{headline(60, 322, "SEE YOUR", 80)}'
        f'{headline(60, 406, "WHOLE PLANT.", 80, RED)}'
        f'{mono(64, 456, "CLEAR SCREENS. LIVE DATA. REAL CONTROL.", fs=21)}'
        f'{g.bus_list(80, 570, items, step=56, fs=23)}'
        f'{g.cta_pill(64, 878, "FREE QUOTE", fs=24)}'
        f'{finish()}'
    )
    return frame(inner)


# ----------------------------------------------------------------------------
# 10 — Thermal imaging
# ----------------------------------------------------------------------------
def ad_thermal():
    th = thermal_rwb("thermal_flir.png")            # 718 x 540
    y0, rows = 50, 400                              # crop rows of the source image
    th = th.crop((0, y0, 718, y0 + rows)).resize((SIZE, round(rows * SIZE / 718)), Image.BICUBIC)
    th = th.filter(ImageFilter.GaussianBlur(1.6))   # soften upscaled sensor pixels
    H = th.height                                   # ~602
    s = SIZE / 718
    hx, hy = 370 * s, (178 - y0) * s                # camera spot-meter position
    inner = (
        f'<rect width="{SIZE}" height="{SIZE}" fill="url(#ink)"/>'
        f'{image(th, 0, 0, SIZE, H)}'
        f'<rect x="0" y="0" width="{SIZE}" height="190" fill="url(#fadeUp)"/>'
        f'<rect x="0" y="{H-200}" width="{SIZE}" height="200" fill="url(#fadeDown)"/>'
        # camera viewfinder
        f'<g stroke="{WHITE}" stroke-width="3" fill="none" opacity="0.85">'
        f'<path d="M40,214 V170 H84"/><path d="M996,170 H1040 V214"/>'
        f'<path d="M40,500 V544 H84"/><path d="M996,544 H1040 V500"/></g>'
        f'<circle cx="{hx}" cy="{hy}" r="46" fill="none" stroke="{WHITE}" stroke-width="2.5"/>'
        f'<circle cx="{hx}" cy="{hy}" r="64" fill="none" stroke="{RED}" stroke-width="2" '
        f'stroke-dasharray="6 6"/>'
        # the camera's own spot reading, redrawn (its tag doesn't survive the re-map)
        f'<rect x="{hx+20}" y="{hy-22}" width="96" height="36" rx="4" fill="{INK}" opacity="0.92"/>'
        f'{mono(hx + 30, hy + 3, "82.0°C", fs=19, fill=WHITE, ls=1)}'
        f'{callout(hx + 46, hy + 30, hx + 190, hy + 130, "HOT SPOT DETECTED")}'
        # brand thermal scale (same 29.4–70.0 °C range as the camera)
        f'<rect x="1004" y="236" width="14" height="240" rx="3" fill="url(#thermBar)" '
        f'stroke="{WHITE}" stroke-width="1" opacity="0.95"/>'
        f'{mono(994, 250, "70.0°C", fs=15, fill=WHITE, ls=1, anchor="end")}'
        f'{mono(994, 474, "29.4°C", fs=15, fill=WHITE, ls=1, anchor="end")}'
        f'<circle cx="890" cy="96" r="7" fill="{RED}"/>'
        f'{mono(906, 102, "IR SCAN", fs=17, fill=WHITE, ls=3)}'
        f'{real_logo(64, 52, 0.9, plate=True)}'
        f'{g.kicker(64, 646, "SWITCHBOARD THERMAL IMAGING")}'
        f'{headline(58, 736, "FIND IT HOT.", 84)}'
        f'{headline(58, 820, "FIX IT COLD.", 84, RED)}'
        f'{mono(64, 862, "NON-INVASIVE SCANS • FULL WRITTEN REPORT", fs=20)}'
        f'{g.cta_pill(694, 676, "BOOK A SCAN", fs=26)}'
        f'{g.pulse(694, 806, 322)}'
        f'{finish(crosshairs=False)}'
    )
    return frame(inner)


# ----------------------------------------------------------------------------
# 11 — Control panels & MCCs
# ----------------------------------------------------------------------------
def ad_panels():
    H = 580
    photo = duo_red(cover(load("mcc_lineup.jpg"), SIZE, H, cy=0.58))
    inner = (
        f'{ground()}'
        f'{image(photo, 0, 0, SIZE, H)}'
        f'<rect x="0" y="0" width="{SIZE}" height="280" fill="url(#fadeUp)"/>'
        f'<rect x="0" y="{H-190}" width="{SIZE}" height="190" fill="url(#fadeDown)"/>'
        f'{g.dim_line(40, 1040, 548, "CONTROL PANELS • MCCs • SWITCHBOARDS")}'
        f'{real_logo(64, 52, 0.9, plate=True)}'
        f'{g.kicker(64, 628, "PANEL BUILDS & MCCs")}'
        f'{headline(58, 712, "BUILT RIGHT.", 80)}'
        f'{headline(58, 792, "WIRED TO LAST.", 80, RED)}'
        f'{bus_pair(858, ["Control panel design & build", "Industrial equipment wiring"], ["MCC & switchboard upgrades", "Preventive maintenance"], step=48, fs=23)}'
        f'{finish(crosshairs=False)}'
    )
    return frame(inner)


# ----------------------------------------------------------------------------
# 12 — Telemetry & remote monitoring
# ----------------------------------------------------------------------------
def signal(cx, cy, n=4, r0=26, gap=26):
    arcs = []
    for i in range(n):
        r = r0 + i * gap
        op = 0.95 - i * 0.2
        arcs.append(
            f'<path d="M{cx - r*0.7071:.1f},{cy - r*0.7071:.1f} A{r},{r} 0 0 1 {cx + r*0.7071:.1f},{cy - r*0.7071:.1f}" '
            f'fill="none" stroke="{RED}" stroke-width="5" stroke-linecap="round" opacity="{op:.2f}"/>'
        )
    return f'<circle cx="{cx}" cy="{cy}" r="7" fill="{RED}"/>' + "".join(arcs)


def ad_telemetry():
    H = 580
    src = load("remote_site.jpg")                   # 1024 x 768
    photo = duo_red(cover(src, SIZE, H, cy=0.47))
    s = SIZE / 1024
    # crop offset (cover() clamps around cy): recompute for overlay positions
    full_h = round(768 * s)
    off = min(max(round(full_h * 0.47 - H / 2), 0), full_h - H)
    kx, ky = 690 * s, 378 * s - off                 # kiosk roof
    ux, uy = 345 * s, 455 * s - off                 # ute
    inner = (
        f'{ground()}'
        f'{image(photo, 0, 0, SIZE, H)}'
        f'<rect x="0" y="0" width="{SIZE}" height="260" fill="url(#fadeUp)"/>'
        f'<rect x="0" y="{H-170}" width="{SIZE}" height="170" fill="url(#fadeDown)"/>'
        f'{signal(kx, ky - 6)}'
        f'{callout(kx + 30, ky + 62, kx - 70, ky + 150, "REMOTE SITE • LIVE", side="left")}'
        f'{callout(ux, uy, ux - 40, uy + 150, "ON SITE ACROSS THE CENTRAL WEST")}'
        f'{real_logo(64, 52, 0.9, plate=True)}'
        f'{g.kicker(64, 628, "TELEMETRY & REMOTE MONITORING")}'
        f'{headline(58, 712, "REMOTE SITE?", 80)}'
        f'{headline(58, 790, EYES, 64, RED)}'
        f'{bus_pair(858, ["Telemetry installation", "Pump control & diagnostics"], ["Remote monitoring", "Instrumentation & controls"], step=48, fs=23)}'
        f'{finish(crosshairs=False)}'
    )
    return frame(inner)


# ----------------------------------------------------------------------------
# 13 — Pump control
# ----------------------------------------------------------------------------
def ad_pump():
    H = 968
    photo = duo_red(cover(load("pump_skid.jpg"), SIZE, H, cx=0.52, cy=0.5))
    inner = (
        f'<rect width="{SIZE}" height="{SIZE}" fill="url(#ink)"/>'
        f'{image(photo, 0, 0, SIZE, H)}'
        f'<rect x="0" y="0" width="{SIZE}" height="220" fill="url(#fadeUp)"/>'
        f'<rect x="0" y="260" width="{SIZE}" height="280" fill="url(#fadeDown)"/>'
        f'<rect x="0" y="538" width="{SIZE}" height="{H-538}" fill="{INK}"/>'
        f'{g.grid()}'
        f'{real_logo(64, 52, 0.9, plate=True)}'
        f'{g.kicker(64, 560, "PUMP CONTROL & DIAGNOSTICS")}'
        f'{headline(58, 652, "KEEP IT", 92)}'
        f'{headline(58, 744, "FLOWING.", 92, RED)}'
        f'{mono(64, 790, "PUMP STATIONS • PROCESS PLANT • RURAL SUPPLY", fs=20)}'
        f'{bus_pair(856, ["Pump control & diagnostics", "Fault finding & repairs"], ["Preventive maintenance", "24/7 industrial breakdowns"], step=50, fs=23)}'
        f'{g.pulse(640, 700, 376)}'
        f'{finish()}'
    )
    return frame(inner)


# ----------------------------------------------------------------------------
# 14 — Brand: on the road
# ----------------------------------------------------------------------------
def ad_ute():
    src = load("ute_storm.jpg")                     # 1200 x 1600, natural colour
    photo = cover(src, SIZE, SIZE, cx=0.5, cy=0.632)
    inner = (
        f'{image(photo, 0, 0, SIZE, SIZE)}'
        f'<rect x="0" y="0" width="{SIZE}" height="470" fill="url(#fadeUp)"/>'
        f'<rect x="0" y="140" width="{SIZE}" height="220" fill="{INK}" opacity="0.35"/>'
        f'{real_logo(64, 52, 0.9, plate=True)}'
        f'{g.kicker(64, 170, "LOCAL SINCE 1986")}'
        f'{headline(58, 232, "WHEREVER THE JOB IS,", 56)}'
        f'{headline(58, 294, THERE, 56, RED)}'
        f'{mono(64, 330, "DUBBO • CENTRAL WEST NSW • INDUSTRIAL • COMMERCIAL", fs=18, fill=WHITE)}'
        f'{finish(crosshairs=False)}'
    )
    return frame(inner)


# ----------------------------------------------------------------------------
ADS = {
    "08_plc_programming":    ad_plc,
    "09_hmi_scada":          ad_hmi,
    "10_thermal_imaging":    ad_thermal,
    "11_control_panels_mcc": ad_panels,
    "12_telemetry_remote":   ad_telemetry,
    "13_pump_control":       ad_pump,
    "14_brand_on_the_road":  ad_ute,
}


def main():
    for name, fn in ADS.items():
        svg = fn()
        cairosvg.svg2png(bytestring=svg.encode(), write_to=os.path.join(HERE, name + ".png"),
                         output_width=SIZE, output_height=SIZE)
        print("wrote", name + ".png")


if __name__ == "__main__":
    main()
