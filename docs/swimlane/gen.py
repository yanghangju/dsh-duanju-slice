# -*- coding: utf-8 -*-
"""生成「麦田」发布链路的泳道活动图：同一份模型同时输出 SVG 和 PNG。"""
import math, os
from PIL import Image, ImageDraw, ImageFont

W, H = 1590, 1158
GUT = 118
LANE_W, LANE_GAP = 228, 12
TOP = 118
ROW_H = 66
NH = 48
SS = 2                      # 超采样倍数
FONT_R = r"C:\Windows\Fonts\msyh.ttc"
FONT_B = r"C:\Windows\Fonts\msyhbd.ttc"
OUT = os.path.dirname(os.path.abspath(__file__))

LANES = ["人 · 创作者", "AI 发布 skill", "麦田中控 hub.mjs", "专用 Chrome · 插件", "各平台后台", "大屏 / 飞书"]
LANE_FILL = ["#fcf9f2", "#f7f2e7", "#fcf9f2", "#f7f2e7", "#fcf9f2", "#f7f2e7"]
LANE_TINT = ["#f2ead8", "#efe6d2", "#f2ead8", "#efe6d2", "#f2ead8", "#efe6d2"]

def lane_left(i): return GUT + i * (LANE_W + LANE_GAP)
def lane_cx(i):   return lane_left(i) + LANE_W / 2
def row_top(r):   return TOP + r * ROW_H

class Node:
    def __init__(self, nid, lane, row, text, kind="proc", w=200, h=NH):
        self.id, self.lane, self.row, self.kind, self.w, self.h = nid, lane, row, kind, w, h
        self.lines = text.split("\n")
        self.cx = lane_cx(lane)
        self.x0, self.x1 = self.cx - w / 2, self.cx + w / 2
        self.y0 = row_top(row) + (ROW_H - h) / 2
        self.y1, self.cy = self.y0 + h, self.y0 + h / 2

N = {}
def node(*a, **k):
    n = Node(*a, **k); N[n.id] = n

node("start", 0, 0, "9:16 成片 + 封面\n放进 NAS 发布工程", "start")
node("copy", 1, 0, "看片 → 写六平台文案\nB站/抖音/小红书/视频号\nYouTube/X/IG → 素材.md", "proc", h=54)
node("pub", 1, 1, "make-publish → publish.json\nvalidate 校验：字数/禁词/\n封面比例/成片 faststart", "proc", h=54)
node("valid", 1, 2, "校验通过？", "decision", w=150)
node("review", 0, 3, "人审六平台文案\n改文案 → 回到 skill", "manual")
node("plan", 0, 4, "hub plan <工程目录>", "manual", w=176)
node("reg", 2, 4, "登记分发计划\nSQLite：状态 = 计划中", "proc")
node("run", 2, 5, "hub run / daemon 到点\n按 batches 分批 · 查库防重", "proc", h=54)
node("fill", 3, 6, "打开上传页 → 传视频+封面\n→ 填文案 → 设定时", "proc", h=54)
node("kind", 2, 7, "平台类别？", "decision", w=150)
node("auto", 3, 8, "自动提交：X / YouTube /\nInstagram / 自有站点\n（回读一致才点）", "auto", h=54)
node("manual", 0, 8, "国内四家：手动点\n「发布 / 定时发布」", "manual", h=54)
node("plat", 4, 9, "平台侧生成作品 / 定时\n创作者后台（只读）", "note")
node("feishu", 5, 5, "飞书卡片：开跑 · 每平台到位\n· 异常 · 等你点（每 20 分钟）", "notify", h=54)
node("sync", 2, 10, "hub sync：取链接\n→ 发布记录.json\n→ 回填 素材.md「已发布」", "proc", h=54)
node("metrics", 2, 11, "每天 10:00 metrics + followers\n新一期头 3 天每 6 小时", "proc", h=54)
node("db", 2, 12, "SQLite  data/hub.db\n长期留存", "db")
node("board", 5, 13, "网页大屏 · 日历 · 单期复盘\n· 转化漏斗\n+ 飞书日报 · 复盘 · 周报", "board", h=54)

EDGES = [
    ("start", "copy", "flat", None), ("copy", "pub", "down", None), ("pub", "valid", "down", None),
    ("valid", "copy", "fb", "否：改文案"), ("valid", "review", "down", "是"),
    ("review", "plan", "down", None), ("plan", "reg", "flat", "登记"), ("reg", "run", "down", None),
    ("run", "feishu", "flat", "通知"), ("run", "fill", "down", None), ("fill", "kind", "down", None),
    ("kind", "auto", "down", "海外 / 自有"), ("kind", "manual", "down", "国内四家"),
    ("auto", "plat", "down", None), ("manual", "plat", "row", None),
    ("plat", "sync", "down", None),
    ("sync", "metrics", "down", None),
    ("metrics", "db", "down", None), ("db", "board", "down", "读"),
]

def build_pts(a, b, route):
    if route == "flat":
        return [(a.x1, a.cy), (b.x0, b.cy)] if b.cx > a.cx else [(a.x0, a.cy), (b.x1, b.cy)]
    if route == "fb":
        ch = lane_left(1) - 7
        ey = b.cy + 14
        return [(a.x0, a.cy), (ch, a.cy), (ch, ey), (b.x0, ey)]
    if route == "side":
        return [(a.x0, a.cy), (b.cx, a.cy), (b.cx, b.y0)]
    if route == "row":
        # 先下到目标行中线，再横向进入目标左边缘
        gy = b.cy
        return [(a.cx, a.y1), (a.cx, gy), (b.x0, gy)]
    if abs(a.cx - b.cx) < 1:
        return [(a.cx, a.y1), (b.cx, b.y0)]
    gap = b.y0 - a.y1
    gy = (a.y1 + b.y0) / 2 if gap < 26 else a.y1 + 11
    return [(a.cx, a.y1), (a.cx, gy), (b.cx, gy), (b.cx, b.y0)]

def text_w(text, size=11.5):
    return sum(size if ord(ch) > 127 else size * 0.58 for ch in text)

def score(x, y, w, h):
    """标签框压到几个节点（含 3px 余量）。"""
    c = 0
    for n in N.values():
        if n.x0 - 3 < x + w / 2 and x - w / 2 < n.x1 + 3 and n.y0 - 3 < y + h / 2 and y - h / 2 < n.y1 + 3:
            c += 1
    return c

def hits(x, y, w, h):
    return score(x, y, w, h) > 0

def label_pos(pts, route, text, opt=None):
    """返回标签位置 —— 贴在最长线段旁，避让节点。"""
    if opt and "lx" in opt:
        return (opt["lx"], opt["ly"])
    tw, th = text_w(text) + 8, 18
    if route == "fb":
        return (pts[1][0] - 46, (pts[1][1] + pts[2][1]) / 2)
    segs = list(zip(pts, pts[1:]))
    i = max(range(len(segs)), key=lambda k: abs(segs[k][1][0] - segs[k][0][0]) + abs(segs[k][1][1] - segs[k][0][1]))
    p, q = segs[i]
    if abs(p[0] - q[0]) < 1:
        mx, my = (p[0] + q[0]) / 2, (p[1] + q[1]) / 2
        cand = [(mx + 9 + tw / 2, my), (mx - 9 - tw / 2, my),
                (mx + 9 + tw / 2, my + 20), (mx - 9 - tw / 2, my + 20)]
    else:
        mx, my = (p[0] + q[0]) / 2, p[1]
        cand = [(mx, my - 12), (mx, my + 13), (mx, my - 21), (mx, my + 22)]
    best, bestsc = cand[0], 999
    for x, y in cand:
        sc = score(x, y, tw, th)
        if sc == 0:
            return (x, y)
        if sc < bestsc:
            best, bestsc = (x, y), sc
    return best

COLORS = {"proc": "#8d8574", "manual": "#5f8fd8", "auto": "#4f9d6b", "decision": "#c1902f",
          "note": "#8d8574", "notify": "#9a7bc0", "board": "#8a6ab8", "start": "#8d8574",
          "warn": "#cf6b6b", "db": "#8d8574"}
STYLE = {
    "proc":     ("#ffffff", "#d9d2c2", "#1c1a16", 1.2),
    "start":    ("#1c1a16", "#1c1a16", "#fffdf8", 1.2),
    "manual":   ("#e9f0fd", "#8fb2ea", "#1b3a70", 1.4),
    "auto":     ("#e8f5ec", "#7cc095", "#1d4a30", 1.4),
    "decision": ("#fdf4dc", "#d9a441", "#6b4a12", 1.5),
    "note":     ("#f1eee5", "#c9c0ab", "#5a5142", 1.2),
    "notify":   ("#f3ecf9", "#b79ad6", "#4b2f6b", 1.2),
    "board":    ("#f1ecfa", "#a98fd0", "#3f2a63", 1.4),
    "warn":     ("#fdeceb", "#e39a93", "#7d2b26", 1.5),
    "db":       ("#f0ece1", "#b0a487", "#4a422f", 1.2),
}
PHASES = [("① 写文案·校验", 0, 2), ("② 人审·登记", 3, 4), ("③ 分发·发布", 5, 9),
          ("④ 回填链接", 10, 10), ("⑤ 采集", 11, 12), ("⑥ 呈现", 13, 13)]

# ============================ SVG ============================
def esc(s): return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

def rounded(pts, r=9):
    d = f"M {pts[0][0]:.1f} {pts[0][1]:.1f}"
    for i in range(1, len(pts) - 1):
        p0, p1, p2 = pts[i - 1], pts[i], pts[i + 1]
        v1 = (p1[0] - p0[0], p1[1] - p0[1]); l1 = math.hypot(*v1)
        v2 = (p2[0] - p1[0], p2[1] - p1[1]); l2 = math.hypot(*v2)
        rr = min(r, l1 / 2, l2 / 2)
        a = (p1[0] - v1[0] / l1 * rr, p1[1] - v1[1] / l1 * rr)
        b = (p1[0] + v2[0] / l2 * rr, p1[1] + v2[1] / l2 * rr)
        d += f" L {a[0]:.1f} {a[1]:.1f} Q {p1[0]:.1f} {p1[1]:.1f} {b[0]:.1f} {b[1]:.1f}"
    return d + f" L {pts[-1][0]:.1f} {pts[-1][1]:.1f}"

def svg():
    o = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" '
         f'font-family="\'Microsoft YaHei\',\'PingFang SC\',\'Noto Sans SC\',sans-serif">', '<defs>']
    for k, c in COLORS.items():
        o.append(f'<marker id="arw-{k}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" '
                 f'markerHeight="7" orient="auto-start-reverse"><path d="M 0 1 L 9 5 L 0 9 z" fill="{c}"/></marker>')
    o.append('<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fffdf8"/>'
             '<stop offset="1" stop-color="#fbf6ec"/></linearGradient></defs>')
    o.append(f'<rect width="{W}" height="{H}" fill="url(#bg)"/>')
    o.append(f'<text x="{GUT}" y="44" font-size="24" font-weight="700" fill="#1c1a16">麦田 · 一期视频从成片到数据大屏</text>')
    o.append(f'<text x="{GUT}" y="70" font-size="13.5" fill="#7d7466">泳道活动图 —— 列 = 参与方，自上而下 = 时间；'
             f'国内四家只填不自动发，最后一下由人点</text>')
    band_h = row_top(13) + ROW_H + 10 - (TOP - 24)
    for i, name in enumerate(LANES):
        x = lane_left(i)
        o.append(f'<rect x="{x}" y="{TOP-24}" width="{LANE_W}" height="{band_h}" fill="{LANE_FILL[i]}" stroke="#e6dfcd"/>')
        o.append(f'<rect x="{x}" y="{TOP-24}" width="{LANE_W}" height="24" fill="{LANE_TINT[i]}" stroke="#e6dfcd"/>')
        o.append(f'<text x="{x+LANE_W/2}" y="{TOP-12}" font-size="13.5" font-weight="700" fill="#5a5142" '
                 f'text-anchor="middle" dominant-baseline="central">{esc(name)}</text>')
    for label, r0, r1 in PHASES:
        y0, y1 = row_top(r0) - 4, row_top(r1) + ROW_H - 2
        cy = (y0 + y1) / 2
        o.append(f'<rect x="10" y="{y0}" width="96" height="{y1-y0}" rx="8" fill="#f3ecdc" stroke="#e2d8c1"/>')
        o.append(f'<text x="58" y="{cy}" font-size="13" font-weight="700" fill="#8a7c5f" text-anchor="middle" '
                 f'transform="rotate(-90 58 {cy})">{esc(label)}</text>')
    for n in N.values():
        fill, stroke, tcol, sw = STYLE[n.kind]
        dash = ' stroke-dasharray="6 4"' if n.kind == "note" else ""
        rx = n.h / 2 if n.kind == "start" else 9
        o.append(f'<rect x="{n.x0:.1f}" y="{n.y0:.1f}" width="{n.w}" height="{n.h}" rx="{rx}" fill="{fill}" '
                 f'stroke="{stroke}" stroke-width="{sw}"{dash}/>')
        if n.kind == "decision":
            dx = n.x0 + 17
            o.append(f'<path d="M {dx-6} {n.cy} L {dx} {n.cy-6} L {dx+6} {n.cy} L {dx} {n.cy+6} Z" '
                     f'fill="none" stroke="{tcol}" stroke-width="1.6"/>')
            o.append(f'<text x="{n.cx+9}" y="{n.cy+4.6}" font-size="13" fill="{tcol}" font-weight="700" '
                     f'text-anchor="middle">{esc(n.lines[0])}</text>')
            continue
        size = 13 if n.kind == "start" else 12.4
        lh = 16 if n.h > 50 else 15.5
        y = n.cy - (len(n.lines) - 1) * lh / 2 + 4.4
        for line in n.lines:
            wt = "700" if n.kind in ("start", "board", "warn") else "400"
            o.append(f'<text x="{n.cx:.1f}" y="{y:.1f}" font-size="{size}" fill="{tcol}" font-weight="{wt}" '
                     f'text-anchor="middle">{esc(line)}</text>')
            y += lh
    for e in EDGES:
        s, d, route, label = e[0], e[1], e[2], e[3]
        opt = e[4] if len(e) > 4 else None
        a, b = N[s], N[d]
        pts = build_pts(a, b, route)
        col = COLORS[b.kind]
        dash = ' stroke-dasharray="5 4"' if route == "fb" else ""
        o.append(f'<path d="{rounded(pts)}" fill="none" stroke="{col}" stroke-width="1.7"{dash} '
                 f'marker-end="url(#arw-{b.kind})"/>')
        if label:
            mx, my = label_pos(pts, route, label, opt)
            tw = text_w(label) + 8
            o.append(f'<rect x="{mx-tw/2}" y="{my-9}" width="{tw}" height="18" rx="4" fill="#fffdf8" opacity=".95"/>')
            o.append(f'<text x="{mx}" y="{my+4}" font-size="11.5" fill="{col}" text-anchor="middle">{esc(label)}</text>')
    ly = row_top(13) + ROW_H + 26
    o.append(f'<text x="{GUT}" y="{ly+4}" font-size="12" font-weight="700" fill="#8a7c5f">图例</text>')
    x = GUT + 46
    for k, lab in [("start", "起点"), ("proc", "系统活动"), ("decision", "判定"), ("manual", "人工操作"),
                   ("auto", "自动提交组"), ("note", "平台侧 / 只读"), ("warn", "告警"), ("board", "呈现")]:
        fill, stroke, tcol, sw = STYLE[k]
        o.append(f'<rect x="{x}" y="{ly-9}" width="26" height="15" rx="4" fill="{fill}" stroke="{stroke}" stroke-width="1.3"/>')
        o.append(f'<text x="{x+32}" y="{ly+3}" font-size="12" fill="#6d6455">{esc(lab)}</text>')
        x += 32 + len(lab) * 13 + 22
    o.append(f'<text x="{W-40}" y="{ly+4}" font-size="11.5" fill="#a89b7f" text-anchor="end">'
             f'虚线框 = 平台侧 / 外部对象 · 虚线箭头 = 返工回环</text>')
    o.append('</svg>')
    open(os.path.join(OUT, "maitian-swimlane.svg"), "w", encoding="utf-8").write("\n".join(o))

# ============================ PNG ============================
def hexc(h, a=255):
    h = h.lstrip("#")
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), a)

_fc = {}
def F(size, bold=False):
    key = (round(size * SS, 1), bold)
    if key not in _fc:
        _fc[key] = ImageFont.truetype(FONT_B if bold else FONT_R, int(round(size * SS)), index=0)
    return _fc[key]

def S(v): return v * SS

def arrow(img, draw, p0, p1, color, width=1.7):
    ang = math.atan2(p1[1] - p0[1], p1[0] - p0[0])
    seg = math.hypot(p1[0] - p0[0], p1[1] - p0[1])
    L = min(9.0, max(4.5, seg * 0.8))
    Wd = L * 0.8
    tip = (p1[0], p1[1])
    bx, by = p1[0] - L * math.cos(ang), p1[1] - L * math.sin(ang)
    nx, ny = -math.sin(ang), math.cos(ang)
    a1 = (bx + nx * Wd / 2, by + ny * Wd / 2)
    a2 = (bx - nx * Wd / 2, by - ny * Wd / 2)
    draw.polygon([(S(tip[0]), S(tip[1])), (S(a1[0]), S(a1[1])), (S(a2[0]), S(a2[1]))], fill=hexc(color))
    # 让线头收在箭头根部
    return (bx, by)

def sample(pts, r=9, n=10):
    """把折线在转角处替换成二次贝塞尔采样点，得到圆角路径。"""
    if len(pts) < 3:
        return list(pts)
    out = [pts[0]]
    for i in range(1, len(pts) - 1):
        p0, p1, p2 = pts[i - 1], pts[i], pts[i + 1]
        v1 = (p1[0] - p0[0], p1[1] - p0[1]); l1 = math.hypot(*v1) or 1
        v2 = (p2[0] - p1[0], p2[1] - p1[1]); l2 = math.hypot(*v2) or 1
        rr = min(r, l1 / 2, l2 / 2)
        a = (p1[0] - v1[0] / l1 * rr, p1[1] - v1[1] / l1 * rr)
        b = (p1[0] + v2[0] / l2 * rr, p1[1] + v2[1] / l2 * rr)
        out.append(a)
        for k in range(1, n):
            t = k / n
            out.append(((1 - t) ** 2 * a[0] + 2 * (1 - t) * t * p1[0] + t * t * b[0],
                        (1 - t) ** 2 * a[1] + 2 * (1 - t) * t * p1[1] + t * t * b[1]))
        out.append(b)
    out.append(pts[-1])
    return out

def draw_polyline(draw, pts, color, width=1.7, dash=None, gap=4.0):
    w = max(1, int(round(width * SS)))
    smp = sample(pts)
    if dash:
        on, remain = True, dash
        for i in range(len(smp) - 1):
            p, q = smp[i], smp[i + 1]
            L = math.hypot(q[0] - p[0], q[1] - p[1])
            if L == 0:
                continue
            t = 0.0
            while t < L - 1e-9:
                step = min(remain, L - t)
                a = (p[0] + (q[0] - p[0]) * t / L, p[1] + (q[1] - p[1]) * t / L)
                t += step
                b = (p[0] + (q[0] - p[0]) * t / L, p[1] + (q[1] - p[1]) * t / L)
                if on:
                    draw.line([(S(a[0]), S(a[1])), (S(b[0]), S(b[1]))], fill=hexc(color), width=w)
                remain -= step
                if remain <= 1e-9:
                    on = not on
                    remain = dash if on else gap
    else:
        draw.line([(S(x), S(y)) for x, y in smp], fill=hexc(color), width=w, joint="curve")
        for x, y in (smp[0], smp[-1]):
            draw.ellipse([S(x) - w / 2, S(y) - w / 2, S(x) + w / 2, S(y) + w / 2], fill=hexc(color))

def rot_text(img, text, font, cx, cy, fill, angle=90):
    tmp = Image.new("RGBA", (int(font.size * len(text) * 1.2) + 40, int(font.size * 2)), (0, 0, 0, 0))
    d = ImageDraw.Draw(tmp)
    d.text((tmp.width // 2, tmp.height // 2), text, font=font, fill=fill, anchor="mm")
    tmp = tmp.rotate(angle, expand=True, resample=Image.BICUBIC)
    img.alpha_composite(tmp, (int(cx - tmp.width / 2), int(cy - tmp.height / 2)))

def png():
    img = Image.new("RGBA", (int(W * SS), int(H * SS)), (255, 253, 248, 255))
    d = ImageDraw.Draw(img)
    # 背景渐变
    top, bot = (255, 253, 248), (251, 246, 236)
    for y in range(img.height):
        t = y / img.height
        d.line([(0, y), (img.width, y)], fill=tuple(int(top[i] + (bot[i] - top[i]) * t) for i in range(3)) + (255,))

    band_h = row_top(13) + ROW_H + 10 - (TOP - 24)
    for i, name in enumerate(LANES):
        x = lane_left(i)
        d.rectangle([S(x), S(TOP - 24), S(x + LANE_W), S(TOP - 24 + band_h)],
                    fill=hexc(LANE_FILL[i]), outline=hexc("#e6dfcd"), width=max(1, int(SS)))
        d.rectangle([S(x), S(TOP - 24), S(x + LANE_W), S(TOP)],
                    fill=hexc(LANE_TINT[i]), outline=hexc("#e6dfcd"), width=max(1, int(SS)))
        d.line([(S(x), S(TOP)), (S(x + LANE_W), S(TOP))], fill=hexc("#e6dfcd"), width=max(1, int(SS)))
        d.text((S(x + LANE_W / 2), S(TOP - 12)), name, font=F(13.5, True), fill=hexc("#5a5142"), anchor="mm")

    d.text((S(GUT), S(36)), "麦田 · 一期视频从成片到数据大屏", font=F(24, True), fill=hexc("#1c1a16"), anchor="ls")
    d.text((S(GUT), S(68)), "泳道活动图 —— 列 = 参与方，自上而下 = 时间；国内四家只填不自动发，最后一下由人点",
           font=F(13.5), fill=hexc("#7d7466"), anchor="ls")

    for label, r0, r1 in PHASES:
        y0, y1 = row_top(r0) - 4, row_top(r1) + ROW_H - 2
        d.rounded_rectangle([S(10), S(y0), S(106), S(y1)], radius=S(8), fill=hexc("#f3ecdc"), outline=hexc("#e2d8c1"))
        rot_text(img, label, F(13, True), S(58), S((y0 + y1) / 2), hexc("#8a7c5f"))

    # 先画节点，再画连线，箭头才不会被节点遮住
    for n in N.values():
        fill, stroke, tcol, sw = STYLE[n.kind]
        rx = n.h / 2 if n.kind == "start" else 9
        d.rounded_rectangle([S(n.x0), S(n.y0), S(n.x1), S(n.y1)], radius=S(rx), fill=hexc(fill),
                            outline=hexc(stroke), width=max(1, int(round(sw * SS))))
        if n.kind == "decision":
            cx, cy = n.x0 + 17, n.cy
            d.polygon([(S(cx - 6), S(cy)), (S(cx), S(cy - 6)), (S(cx + 6), S(cy)), (S(cx), S(cy + 6))],
                      outline=hexc(tcol), width=max(1, int(1.6 * SS)))
            d.text((S(n.cx + 9), S(n.cy)), n.lines[0], font=F(13, True), fill=hexc(tcol), anchor="mm")
            continue
        size = 13 if n.kind == "start" else 12.4
        lh = 16 if n.h > 50 else 15.5
        y = n.cy - (len(n.lines) - 1) * lh / 2
        bold = n.kind in ("start", "board", "warn")
        for line in n.lines:
            d.text((S(n.cx), S(y)), line, font=F(size, bold), fill=hexc(tcol), anchor="mm")
            y += lh

    for e in EDGES:
        s, t, route, label = e[0], e[1], e[2], e[3]
        opt = e[4] if len(e) > 4 else None
        a, b = N[s], N[t]
        pts = build_pts(a, b, route)
        col = COLORS[b.kind]
        shaft = pts[:-1] + [arrow(None, d, pts[-2], pts[-1], col)]
        if route == "fb":
            draw_polyline(d, shaft, col, 1.7, dash=5, gap=4)
        else:
            draw_polyline(d, shaft, col, 1.7)
        if label:
            mx, my = label_pos(pts, route, label, opt)
            f = F(11.5)
            tw = d.textlength(label, font=f) / SS + 8
            d.rounded_rectangle([S(mx - tw / 2), S(my - 9), S(mx + tw / 2), S(my + 9)], radius=S(4),
                                fill=(255, 253, 248, 242))
            d.text((S(mx), S(my)), label, font=f, fill=hexc(col), anchor="mm")

    ly = row_top(13) + ROW_H + 26
    d.text((S(GUT), S(ly)), "图例", font=F(12, True), fill=hexc("#8a7c5f"), anchor="lm")
    x = GUT + 46
    for k, lab in [("start", "起点"), ("proc", "系统活动"), ("decision", "判定"), ("manual", "人工操作"),
                   ("auto", "自动提交组"), ("note", "平台侧 / 只读"), ("warn", "告警"), ("board", "呈现")]:
        fill, stroke, tcol, sw = STYLE[k]
        d.rounded_rectangle([S(x), S(ly - 8), S(x + 26), S(ly + 7)], radius=S(4), fill=hexc(fill),
                            outline=hexc(stroke), width=max(1, int(1.3 * SS)))
        d.text((S(x + 32), S(ly)), lab, font=F(12), fill=hexc("#6d6455"), anchor="lm")
        x += 32 + d.textlength(lab, font=F(12)) / SS + 20
    note = "虚线框 = 平台侧 / 外部对象 · 虚线箭头 = 返工回环"
    d.text((S(W - 40), S(ly)), note, font=F(11.5), fill=hexc("#a89b7f"), anchor="rm")

    # 文字溢出检查
    for n in N.values():
        if n.kind == "decision":
            continue
        size = 13 if n.kind == "start" else 12.4
        bold = n.kind in ("start", "board", "warn")
        for line in n.lines:
            wpx = d.textlength(line, font=F(size, bold)) / SS
            if wpx > n.w - 10:
                print(f"WARN overflow {n.id}: {wpx:.0f} > {n.w - 10} :: {line}")

    img.convert("RGB").resize((W, H), Image.LANCZOS).save(os.path.join(OUT, "maitian-swimlane.png"))
    img.convert("RGB").save(os.path.join(OUT, "maitian-swimlane@2x.png"))

if __name__ == "__main__":
    svg()
    png()
    print("done")
