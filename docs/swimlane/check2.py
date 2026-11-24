import io
from pathlib import Path

import gen
from PIL import ImageFont

out = io.StringIO()
def p(*a):
    print(*a, file=out)

def tw_of(label):
    f = ImageFont.truetype(r"C:\Windows\Fonts\msyh.ttc", 40)
    return f.getlength(label) / 40 * 11.5 + 8

def overlap(b1, b2):
    return not (b1[2] <= b2[0] or b2[2] <= b1[0] or b1[3] <= b2[1] or b2[3] <= b1[1])

def on_border(pt, n, tol=1.5):
    x, y = pt
    if not (n.x0 - tol <= x <= n.x1 + tol and n.y0 - tol <= y <= n.y1 + tol):
        return False
    return (abs(x - n.x0) <= tol or abs(x - n.x1) <= tol or abs(y - n.y0) <= tol or abs(y - n.y1) <= tol)

def seg_hits_box(a, b, n, pad=2):
    x0, y0, x1, y1 = n.x0 + pad, n.y0 + pad, n.x1 - pad, n.y1 - pad
    if abs(a[1] - b[1]) < 0.01:
        if not (y0 < a[1] < y1):
            return False
        lo, hi = min(a[0], b[0]), max(a[0], b[0])
        return hi > x0 and lo < x1
    if abs(a[0] - b[0]) < 0.01:
        if not (x0 < a[0] < x1):
            return False
        lo, hi = min(a[1], b[1]), max(a[1], b[1])
        return hi > y0 and lo < y1
    return False

labels = []
p(f"尺寸 {gen.W}x{gen.H}")
for e in gen.EDGES:
    s, t, route, label = e[0], e[1], e[2], e[3]
    opt = e[4] if len(e) > 4 else None
    a, b = gen.N[s], gen.N[t]
    pts = gen.build_pts(a, b, route)
    tip = pts[-1]
    msgs = []
    if not on_border(tip, b):
        msgs.append("箭头没落在目标边框")
    for name, n in gen.N.items():
        if name in (s, t):
            continue
        for i in range(len(pts) - 1):
            if seg_hits_box(pts[i], pts[i + 1], n):
                msgs.append("线穿过 " + name)
                break
    if label:
        mx, my = gen.label_pos(pts, route, label, opt)
        w = tw_of(label)
        box = (mx - w / 2, my - 9, mx + w / 2, my + 9)
        labels.append((label, box))
        for name, n in gen.N.items():
            if overlap(box, (n.x0, n.y0, n.x1, n.y1)):
                msgs.append(f"标签压到 {name}")
        if box[0] < 8 or box[2] > gen.W - 8 or box[1] < 100:
            msgs.append("标签跑出安全区")
    if msgs:
        p(f"  {s}->{t} [{route}] : " + "；".join(msgs))

for i in range(len(labels)):
    for j in range(i + 1, len(labels)):
        if overlap(labels[i][1], labels[j][1]):
            p(f"  标签互压: {labels[i][0]} / {labels[j][0]}")

p("检查完毕")
Path(__file__).with_name("check.txt").write_text(out.getvalue(), encoding="utf-8")
