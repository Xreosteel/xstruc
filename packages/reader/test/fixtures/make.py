"""Test drawings for @xstruc/reader, written with ezdxf (a real CAD library, research/04: fixtures a CAD kernel accepts).

Run: python3 make.py  (pip install ezdxf==1.4.5). Writes the .dxf files beside this script; they are committed.

level1.dxf     the engine's Level 1 example drawn as a consultant's slab plan (mm, grid bubbles as blocks with labels,
               slab edge with a north balcony, crossed voids, a hatched set-down, a step, columns, dimensions, general
               notes, four mat callouts with distribution lines, a trimmer callout on a leader), placed far from 0,0.
metres.dxf     a 5 x 4 bay plan in metres with the grids lettered across and numbered up, bubbles as circle + text,
               notes as separate TEXT, a top mesh and one bottom mat written with a lone B.
nounits.dxf    metres.dxf without $INSUNITS (units worked out from the size).
washpad.pdf    an invented slab-on-ground pad drawn the way a real consultant's PDF plot comes out (no grids; edges as
               separate lines and an L-shaped polyline; dashed lines as separate dashes; a drain strip; callouts
               "N12-200 / TOP & BOT" written on their distribution lines with arrowheads; scale 1:50 in the title
               block; dimension figures), page 2 a sections sheet. Written with reportlab (pip install reportlab).
problems.dxf   level1 with things a reader must not guess: a mat without a direction, an each-way mat, two top mats
               without T1/T2, a mat over part of the slab, two different covers, no thickness note.
"""
import ezdxf
from ezdxf.enums import TextEntityAlignment
from ezdxf.math import Vec2

OX, OY = 100000.0, 50000.0          # drawing coordinates of grid 1 / A (the engine's 0, 0)
GX = [0, 5000, 9500, 14000]
GY = [0, 4500, 9000]
OV = 250
H = 250                             # text height: 2.5 mm at 1:100


def P(x, y):
    return (OX + x, OY + y)


def new(units=4):
    doc = ezdxf.new("R2018", setup=True)
    doc.header["$INSUNITS"] = units
    for name, color, lt in [("S-GRID", 1, "CENTER"), ("S-GRID-TEXT", 7, "CONTINUOUS"), ("S-SLAB-EDGE", 7, "CONTINUOUS"), ("S-SLAB-OPEN", 7, "CONTINUOUS"),
                            ("S-SLAB-STEP", 8, "DASHED"), ("S-COLS", 7, "CONTINUOUS"), ("S-BEAM", 7, "HIDDEN"), ("S-ANNO-DIMS", 3, "CONTINUOUS"),
                            ("S-ANNO-NOTE", 7, "CONTINUOUS"), ("S-REO-TEXT", 2, "CONTINUOUS"), ("S-REO-DIST", 2, "CONTINUOUS"), ("S-TTLB", 7, "CONTINUOUS")]:
        doc.layers.add(name, color=color, linetype=lt)
    return doc


def bubble_block(doc, r):
    blk = doc.blocks.new("GRID_BUBBLE")
    blk.add_circle((0, 0), r, dxfattribs={"layer": "0"})
    blk.add_attdef("GRID", (0, 0), dxfattribs={"height": r * 0.9, "layer": "0"}).set_placement((0, 0), align=TextEntityAlignment.MIDDLE_CENTER)


def grids(msp, gx, gy, ov, labels_x, labels_y, r, as_block=True, f=1.0):
    ext = ov + 1500 * f
    def bub(cx, cy, label):
        if as_block:
            ref = msp.add_blockref("GRID_BUBBLE", (cx, cy), dxfattribs={"layer": "S-GRID"})
            ref.add_auto_attribs({"GRID": label})
        else:
            msp.add_circle((cx, cy), r, dxfattribs={"layer": "S-GRID-TEXT"})
            msp.add_text(label, height=r * 0.9, dxfattribs={"layer": "S-GRID-TEXT"}).set_placement((cx, cy), align=TextEntityAlignment.MIDDLE_CENTER)
    for x, lab in zip(gx, labels_x):
        y0, y1 = gy[0] - ext, gy[-1] + ext
        msp.add_line(P2(x, y0, f), P2(x, y1, f), dxfattribs={"layer": "S-GRID"})
        bub(P2(x, y0, f)[0], P2(x, y0, f)[1] - r, lab)
        bub(P2(x, y1, f)[0], P2(x, y1, f)[1] + r, lab)
    for y, lab in zip(gy, labels_y):
        x0, x1 = gx[0] - ext, gx[-1] + ext
        msp.add_line(P2(x0, y, f), P2(x1, y, f), dxfattribs={"layer": "S-GRID"})
        bub(P2(x0, y, f)[0] - r, P2(x0, y, f)[1], lab)
        bub(P2(x1, y, f)[0] + r, P2(x1, y, f)[1], lab)


def P2(x, y, f=1.0):
    return ((OX + x) * f, (OY + y) * f) if f == 1.0 else (x * f, y * f)


def rect(msp, x0, y0, x1, y1, layer, f=1.0):
    return msp.add_lwpolyline([P2(x0, y0, f), P2(x1, y0, f), P2(x1, y1, f), P2(x0, y1, f)], close=True, dxfattribs={"layer": layer})


def mtext(msp, s, x, y, layer, att=5, rot=0, f=1.0, h=H):
    m = msp.add_mtext(s, dxfattribs={"layer": layer, "char_height": h * f, "attachment_point": att, "insert": P2(x, y, f)})
    if rot:
        m.dxf.rotation = rot
    return m


def dist_line(msp, x0, y0, x1, y1, f=1.0):
    """A distribution line with a 45-degree tick at each end, as a placing drawing shows a run's extent."""
    msp.add_line(P2(x0, y0, f), P2(x1, y1, f), dxfattribs={"layer": "S-REO-DIST"})
    t = 150
    for (x, y) in [(x0, y0), (x1, y1)]:
        msp.add_line(P2(x - t, y - t, f), P2(x + t, y + t, f), dxfattribs={"layer": "S-REO-DIST"})


def level1(path, problems=False):
    doc = new()
    msp = doc.modelspace()
    bubble_block(doc, 500)
    grids(msp, GX, GY, OV, ["1", "2", "3", "4"], ["A", "B", "C"], 500)
    sx0, sy0, sx1, sy1 = -OV, -OV, GX[-1] + OV, GY[-1] + OV
    # slab edge with the north balcony (4200 to 9200 along grid C side, 1800 out)
    bx0, bx1, proj = 4200, 9200, 1800
    msp.add_lwpolyline([P(sx0, sy0), P(sx1, sy0), P(sx1, sy1), P(bx1, sy1), P(bx1, sy1 + proj), P(bx0, sy1 + proj), P(bx0, sy1), P(sx0, sy1)],
                       close=True, dxfattribs={"layer": "S-SLAB-EDGE"})
    mtext(msp, "BALCONY\\P180 THK\\PSET DOWN 50", (bx0 + bx1) / 2, sy1 + proj / 2, "S-ANNO-NOTE")
    # openings with the void cross
    for name, x0, y0, x1, y1 in [("STAIR VOID", 10800, 900, 13400, 3100), ("RISER", 3000, 2000, 3600, 2600)]:
        rect(msp, x0, y0, x1, y1, "S-SLAB-OPEN")
        msp.add_line(P(x0, y0), P(x1, y1), dxfattribs={"layer": "S-SLAB-OPEN"})
        msp.add_line(P(x0, y1), P(x1, y0), dxfattribs={"layer": "S-SLAB-OPEN"})
        if name == "RISER":   # too small to write in: on a leader
            msp.add_leader([P((x0 + x1) / 2, (y0 + y1) / 2), P(x1 + 500, y1 + 600), P(x1 + 900, y1 + 600)], dxfattribs={"layer": "S-ANNO-NOTE"})
            msp.add_text(name, height=H, dxfattribs={"layer": "S-ANNO-NOTE"}).set_placement(P(x1 + 950, y1 + 600), align=TextEntityAlignment.MIDDLE_LEFT)
        else:
            mtext(msp, name, (x0 + x1) / 2, (y0 + y1) / 2 + 400, "S-ANNO-NOTE")
    # wet-area set-down, hatched, dashed edge
    rect(msp, 600, 5300, 3800, 8200, "S-SLAB-STEP")
    h = msp.add_hatch(color=8, dxfattribs={"layer": "S-SLAB-STEP"})
    h.set_pattern_fill("ANSI31", scale=20)
    h.paths.add_polyline_path([P(600, 5300), P(3800, 5300), P(3800, 8200), P(600, 8200)], is_closed=True)
    mtext(msp, "WET AREA\\PSET DOWN 70", 2200, 6750, "S-ANNO-NOTE")
    # step up in the north-east corner
    rect(msp, 9500, 4500, sx1, sy1, "S-SLAB-STEP")
    mtext(msp, "STEP UP 200\\PNIB 300", 11900, 6900, "S-ANNO-NOTE")
    # columns and beams (seen, not built from the drawing yet)
    for x in GX:
        for y in GY:
            rect(msp, x - 200, y - 200, x + 200, y + 200, "S-COLS")
    for y in [4500]:
        msp.add_line(P(0, y - 300), P(GX[-1], y - 300), dxfattribs={"layer": "S-BEAM"})
        msp.add_line(P(0, y + 300), P(GX[-1], y + 300), dxfattribs={"layer": "S-BEAM"})
    # dimensions between grids
    for a, b in zip(GX, GX[1:]):
        msp.add_linear_dim(base=P(0, sy0 - 900), p1=P(a, 0), p2=P(b, 0), dxfattribs={"layer": "S-ANNO-DIMS"}).render()
    for a, b in zip(GY, GY[1:]):
        msp.add_linear_dim(base=P(sx0 - 900, 0), p1=P(0, a), p2=P(0, b), angle=90, dxfattribs={"layer": "S-ANNO-DIMS"}).render()
    # mats with distribution lines across the bars, end to end of the slab
    mats = [("N16-200 B1 E-W", "V", 2000), ("N12-200 B2 N-S", "H", 1500), ("N12-150 T2 N-S", "H", 7600), ("N12-150 T1 E-W", "V", 7000)]
    if problems:
        mats = [("N16-200 B1", "V", 2000), ("N12-200 B EW", "H", 1500), ("N12-150 T N-S", "H", 7600), ("N12-150 T E-W", "V", 7000)]
    for text, way, at in mats:
        if way == "V":
            dist_line(msp, at, sy0 + 30, at, sy1 - 30)
            mtext(msp, text, at + 150, 1000 if at < 5000 else 3300, "S-REO-TEXT", att=4)
        else:
            dist_line(msp, sx0 + 30, at, sx1 - 30, at)
            mtext(msp, text, 6500, at + 150, "S-REO-TEXT", att=7)
    if problems:   # a top-up over one bay only
        dist_line(msp, 600, 4000, 3800, 4000)
        mtext(msp, "N16-200 T1 N-S", 700, 4150, "S-REO-TEXT", att=7)
    # a trimmer callout on a leader
    msp.add_leader([P(10800, 3200), P(10300, 3800), P(9900, 3800)], dxfattribs={"layer": "S-REO-TEXT"})
    msp.add_text("2-N16 TRIMMERS T&B", height=H, dxfattribs={"layer": "S-REO-TEXT"}).set_placement(P(9850, 3800), align=TextEntityAlignment.MIDDLE_RIGHT)
    # general notes and title, right of the plan
    notes = "GENERAL NOTES\\P1. SLAB 200 THK U.N.O.\\P2. CONCRETE N32 (f'c = 32 MPa)\\P3. COVER 30 TOP AND BOTTOM\\P4. LAPS 600 U.N.O."
    if problems:
        notes = "GENERAL NOTES\\P1. CONCRETE N32 (f'c = 32 MPa)\\P2. COVER 30 TOP\\P3. COVER 40 BOTTOM\\P4. LAPS 600 U.N.O."
    mtext(msp, notes, 18000, 8000, "S-ANNO-NOTE", att=1, h=300)
    msp.add_text("LEVEL 1 SLAB REINFORCEMENT PLAN", height=500, dxfattribs={"layer": "S-TTLB"}).set_placement(P(18000, -1500))
    msp.add_text("SCALE 1:100 @ A1", height=300, dxfattribs={"layer": "S-TTLB"}).set_placement(P(18000, -2200))
    doc.saveas(path)


def entities(path):
    """One of each entity kind the reader handles, for the DXF reader's own tests."""
    doc = ezdxf.new("R2018", setup=True)
    doc.header["$INSUNITS"] = 4
    doc.layers.add("S-GRID", color=1, linetype="CENTER")
    msp = doc.modelspace()
    msp.add_line((0, 0), (1000, 0), dxfattribs={"layer": "S-GRID", "handle": None} if False else {"layer": "S-GRID"})
    msp.add_lwpolyline([(0, 0, 0, 0, 1), (1000, 0, 0, 0, 0), (1000, 500), (0, 500)], format="xyseb", close=True)
    msp.add_circle((50, 50), 400)
    msp.add_arc((0, 0), 100, 0, 90)
    msp.add_text("N12-200 T1 %%c", height=250, rotation=90, dxfattribs={"insert": (10, 20)})
    msp.add_text("CENTRE", height=100).set_placement((500, 500), align=TextEntityAlignment.MIDDLE_CENTER)
    msp.add_mtext("{\\fArial|b1;N16-200}\\PB1 E-W \\LUNDER\\l \\S1/2;", dxfattribs={"char_height": 250, "insert": (3000, 3000), "attachment_point": 5})
    blk = doc.blocks.new("BUB")
    blk.add_circle((0, 0), 400)
    blk.add_attdef("G", (0, 0), dxfattribs={"height": 300})
    ref = msp.add_blockref("BUB", (5000, 6000), dxfattribs={"rotation": 30, "xscale": 2, "yscale": 2})
    ref.add_auto_attribs({"G": "A"})
    msp.add_blockref("BUB", (7000, 0), dxfattribs={"extrusion": (0, 0, -1)})
    msp.add_linear_dim(base=(0, -500), p1=(0, 0), p2=(4500, 0)).render()
    msp.add_leader([(0, 0), (500, 500), (900, 500)])
    h = msp.add_hatch(color=2)
    h.paths.add_polyline_path([(0, 0), (100, 0), (100, 100), (0, 100)], is_closed=True)
    msp.add_text("ON THE SHEET", height=100, dxfattribs={"paperspace": 1}) if False else doc.layout("Layout1").add_text("ON THE SHEET", height=3)
    msp.add_ellipse((0, 0), major_axis=(100, 0), ratio=0.5)
    doc.saveas(path)


def metres(path, units=6):
    doc = new(units)
    msp = doc.modelspace()
    f = 0.001
    gx = [0, 6000, 12000, 19200, 25200]
    gy = [0, 7000, 14000, 21000]
    grids(msp, gx, gy, 300, ["A", "B", "C", "D", "E"], ["1", "2", "3", "4"], 600 * f, as_block=False, f=f)
    rect(msp, -300, -300, gx[-1] + 300, gy[-1] + 300, "S-SLAB-EDGE", f=f)
    for i, s in enumerate(["250 THICK SLAB", "N40 CONCRETE", "COVER 25", "LAP 500"]):
        msp.add_text(s, height=0.35, dxfattribs={"layer": "S-ANNO-NOTE"}).set_placement((29.0, 20.0 - i * 0.6))
    msp.add_text("SL92 T E-W", height=0.3, dxfattribs={"layer": "S-REO-TEXT"}).set_placement((29.0, 16.0))
    msp.add_text("N12-200 B E-W", height=0.3, dxfattribs={"layer": "S-REO-TEXT"}).set_placement((29.0, 15.4))
    doc.saveas(path)


def washpad_pdf(path):
    """An invented 13.5 x 7.5 m pad at 1:50 on A3, drawn as an AutoCAD plot draws it (see the module docstring)."""
    from reportlab.pdfgen import canvas
    from reportlab.lib.pagesizes import A3, landscape
    W, Hh = landscape(A3)
    pt = 72 / 25.4
    S = 50.0
    ox, oy = 60 * pt, 80 * pt           # sheet position of the pad's bottom-left corner
    def X(d): return ox + d / S * pt   # drawing mm -> sheet points
    def Y(d): return oy + d / S * pt
    c = canvas.Canvas(path, pagesize=(W, Hh))
    c.setLineWidth(0.35)
    def line(x0, y0, x1, y1): c.line(X(x0), Y(y0), X(x1), Y(y1))
    def dashes(x0, y0, x1, y1, on=600, off=75):
        import math
        L = math.hypot(x1 - x0, y1 - y0); ux, uy = (x1 - x0) / L, (y1 - y0) / L; t = 0
        while t < L:
            e = min(L, t + on); line(x0 + ux * t, y0 + uy * t, x0 + ux * e, y0 + uy * e); t = e + off
    def arrow(x, y, dx, dy):
        p = c.beginPath(); s2 = 180
        p.moveTo(X(x), Y(y)); p.lineTo(X(x - dx * s2 - dy * s2 / 4), Y(y - dy * s2 + dx * s2 / 4)); p.lineTo(X(x - dx * s2 + dy * s2 / 4), Y(y - dy * s2 - dx * s2 / 4)); p.close()
        c.drawPath(p, stroke=1, fill=1)
    def text(s, x, y, h=125, rot=0, size=None):
        c.saveState(); c.translate(X(x), Y(y)); c.rotate(rot); c.setFont("Helvetica", (size or h / S) * pt); c.drawString(0, 0, s); c.restoreState()
    # sheet border and title block
    c.rect(10 * pt, 10 * pt, W - 20 * pt, Hh - 20 * pt)
    c.line(10 * pt, 40 * pt, W - 10 * pt, 40 * pt)
    for xx in [300, 340, 380]: c.line(xx * pt, 10 * pt, xx * pt, 40 * pt)
    c.setFont("Helvetica", 2.5 * pt); c.drawString(302 * pt, 30 * pt, "SCALE"); c.drawString(342 * pt, 30 * pt, "PAPER SIZE")
    c.setFont("Helvetica", 4 * pt); c.drawString(302 * pt, 18 * pt, "1:50"); c.drawString(342 * pt, 18 * pt, "A3")
    c.setFont("Helvetica", 5 * pt); c.drawString(150 * pt, 22 * pt, "EXAMPLE PAD")
    # pad edges: left and top as lines, bottom and right as one L-shaped polyline (as the real plot has them)
    line(0, 0, 0, 7500); line(0, 7500, 13500, 7500)
    p = c.beginPath(); p.moveTo(X(0), Y(0)); p.lineTo(X(13500), Y(0)); p.lineTo(X(13500), Y(7500)); c.drawPath(p, stroke=1, fill=0)
    # kerbs: 150 walls each side, 400 bumpers at the ends
    line(0, 150, 13500, 150); line(0, 7350, 13500, 7350); line(400, 150, 400, 7350); line(13100, 150, 13100, 7350)
    # thickened edge below the slab, hidden: dashed, plotted as separate dashes
    for a in [(300, 300, 13200, 300), (300, 7200, 13200, 7200), (300, 300, 300, 7200), (13200, 300, 13200, 7200)]: dashes(*a)
    # the centre drain: a 510 strip between the kerbs
    line(6495, 150, 6495, 7350); line(7005, 150, 7005, 7350)
    # mats: written ON their distribution lines (the line broken where the text is), arrowheads at the ends
    from reportlab.pdfbase.pdfmetrics import stringWidth
    tw = stringWidth("TOP & BOT", "Helvetica", 125 / S * pt) / pt * S   # drawing mm
    line(50, 4200, 9100 - 20, 4200); line(9100 + tw + 20, 4200, 13450, 4200); arrow(50, 4200, -1, 0); arrow(13450, 4200, 1, 0)
    text("N12-200", 9100, 4230); text("TOP & BOT", 9100, 4030)
    line(11000, 50, 11000, 3100 - 20); line(11000, 3100 + tw + 20, 11000, 7450); arrow(11000, 50, 0, -1); arrow(11000, 7450, 0, 1)
    text("N12-200", 10970, 3100, rot=90); text("TOP & BOT", 11170, 3100, rot=90)
    # dimensions: figures over dimension lines
    line(0, 8200, 13500, 8200); text("13500", 6400, 8260)
    line(-700, 0, -700, 7500); text("7500", -760, 3500, rot=90)
    line(0, -700, 6495, -700); text("6495", 3000, -640)
    text("EXAMPLE PAD REBAR PLAN", 4500, -1800, h=250)
    c.showPage()
    # page 2: a sections sheet (the reader should say it is not a plan)
    c.rect(10 * pt, 10 * pt, W - 20 * pt, Hh - 20 * pt)
    c.setFont("Helvetica", 6 * pt); c.drawString(150 * pt, 22 * pt, "EXAMPLE PAD SECTIONS AND DETAILS")
    c.setFont("Helvetica", 4 * pt); c.drawString(302 * pt, 18 * pt, "1:50")
    c.rect(60 * pt, 150 * pt, 270 * pt, 8 * pt)
    c.setFont("Helvetica", 2.5 * pt); c.drawString(120 * pt, 165 * pt, "N12-200"); c.drawString(200 * pt, 165 * pt, "N12-300 (TYP.)")
    c.showPage()
    c.save()


if __name__ == "__main__":
    import os
    here = os.path.dirname(os.path.abspath(__file__))
    level1(os.path.join(here, "level1.dxf"))
    level1(os.path.join(here, "problems.dxf"), problems=True)
    metres(os.path.join(here, "metres.dxf"))
    metres(os.path.join(here, "nounits.dxf"), units=0)
    entities(os.path.join(here, "entities.dxf"))
    washpad_pdf(os.path.join(here, "washpad.pdf"))
    print("fixtures written")
