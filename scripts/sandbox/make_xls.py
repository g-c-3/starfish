"""Builds sample workbooks (pictures, charts, shapes, a plain one) and converts them to the old .xls format with the office suite.
Usage: python3 make_xls.py [outdir]   (default /tmp/arkly-samples). Needs: openpyxl, pillow, soffice.
"""
import os
import subprocess
import sys
import zipfile

import openpyxl
from openpyxl.chart import BarChart, LineChart, PieChart, Reference, ScatterChart, Series
from openpyxl.comments import Comment
from openpyxl.drawing.image import Image as XImage
from PIL import Image, ImageDraw

OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp/arkly-samples'
os.makedirs(OUT, exist_ok=True)
os.chdir(OUT)


def pngs():
    im = Image.new('RGB', (300, 200), 'white'); d = ImageDraw.Draw(im)
    d.rectangle([0, 0, 149, 99], fill='red'); d.rectangle([150, 100, 299, 199], fill='blue'); d.ellipse([100, 50, 200, 150], fill='green')
    im.save('a.png'); im.save('b.jpg', quality=90)


def pictures_and_chart():  # in7: three pictures (one image twice), a bar chart, a wider column
    wb = openpyxl.Workbook(); ws = wb.active; ws.title = 'Pics'
    for r in range(1, 15):
        ws.append([f'row {r}', r, r * 2])
    ws.column_dimensions['A'].width = 18
    for path, size, cell in (('a.png', (150, 100), 'E2'), ('b.jpg', (200, 120), 'E9'), ('a.png', (80, 60), 'B12')):
        im = XImage(path); im.width, im.height = size; ws.add_image(im, cell)
    ch = BarChart(); ch.add_data(Reference(ws, min_col=2, min_row=1, max_row=8)); ws.add_chart(ch, 'J2')
    wb.save('in7.xlsx')


def five_charts():  # in8: clustered column with titles, line, pie, scatter, stacked horizontal bar
    wb = openpyxl.Workbook(); ws = wb.active; ws.title = 'Data'
    ws.append(['Month', 'Sales', 'Costs'])
    for i, m in enumerate(['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'], 1):
        ws.append([m, i * 10 + 5, i * 6 + 3])
    data = Reference(ws, min_col=2, max_col=3, min_row=1, max_row=7); cats = Reference(ws, min_col=1, min_row=2, max_row=7)
    c1 = BarChart(); c1.type = 'col'; c1.title = 'Sales and costs'; c1.y_axis.title = 'Amount'; c1.x_axis.title = 'Month'; c1.add_data(data, titles_from_data=True); c1.set_categories(cats); ws.add_chart(c1, 'E2')
    c2 = LineChart(); c2.title = 'Trend'; c2.add_data(data, titles_from_data=True); c2.set_categories(cats); ws.add_chart(c2, 'E20')
    c3 = PieChart(); c3.title = 'Share'; c3.add_data(Reference(ws, min_col=2, min_row=1, max_row=7), titles_from_data=True); c3.set_categories(cats); ws.add_chart(c3, 'N2')
    c4 = ScatterChart(); c4.title = 'XY'; c4.series.append(Series(Reference(ws, min_col=3, min_row=2, max_row=7), Reference(ws, min_col=2, min_row=2, max_row=7), title='pts')); ws.add_chart(c4, 'N20')
    c5 = BarChart(); c5.type = 'bar'; c5.grouping = 'stacked'; c5.overlap = 100; c5.add_data(data, titles_from_data=True); c5.set_categories(cats); ws.add_chart(c5, 'E38')
    wb.save('in8.xlsx')


def shapes():  # in9: a text box, an oval and a rounded rectangle written into the drawing by hand, a picture and a note
    wb = openpyxl.Workbook(); ws = wb.active
    for r in range(1, 12):
        ws.append([f'row {r}', r])
    im = XImage('a.png'); im.width, im.height = 80, 50; ws.add_image(im, 'H2')
    ws['A2'].comment = Comment('a note', 'me')
    wb.save('base9.xlsx')
    ns = 'xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"'

    def anchor(c1, r1, c2, r2, i, name, prst, fill, ln, txt, tx=False):
        body = f'<xdr:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US" sz="1400" b="1"/><a:t>{txt}</a:t></a:r></a:p></xdr:txBody>' if txt else ''
        return (f'<xdr:twoCellAnchor {ns}><xdr:from><xdr:col>{c1}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>{r1}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>'
                f'<xdr:to><xdr:col>{c2}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>{r2}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:sp macro="" textlink="">'
                f'<xdr:nvSpPr><xdr:cNvPr id="{i}" name="{name}"/><xdr:cNvSpPr{" txBox=\"1\"" if tx else ""}/></xdr:nvSpPr><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></a:xfrm>'
                f'<a:prstGeom prst="{prst}"><a:avLst/></a:prstGeom>{fill}{ln}</xdr:spPr>{body}</xdr:sp><xdr:clientData/></xdr:twoCellAnchor>')
    solid = lambda h: f'<a:solidFill><a:srgbClr val="{h}"/></a:solidFill>'
    line = lambda h, w: f'<a:ln w="{w}"><a:solidFill><a:srgbClr val="{h}"/></a:solidFill></a:ln>'
    extra = (anchor(2, 2, 5, 5, 20, 'TextBox 1', 'rect', solid('FFFF99'), line('FF0000', 19050), 'Hello box', True)
             + anchor(2, 6, 4, 9, 21, 'Oval 1', 'ellipse', solid('99CCFF'), line('0000FF', 12700), '')
             + anchor(5, 6, 7, 9, 22, 'Round 1', 'roundRect', solid('CCFFCC'), '<a:ln><a:noFill/></a:ln>', 'Rounded'))
    zin = zipfile.ZipFile('base9.xlsx'); zout = zipfile.ZipFile('in9.xlsx', 'w', zipfile.ZIP_DEFLATED)
    for it in zin.infolist():
        d = zin.read(it.filename)
        if it.filename.startswith('xl/drawings/drawing') and it.filename.endswith('.xml'):
            t = d.decode(); assert '</wsDr>' in t; d = t.replace('</wsDr>', extra + '</wsDr>').encode()
        zout.writestr(it, d)
    zout.close()


def plain():  # a workbook without drawings
    wb = openpyxl.Workbook(); ws = wb.active
    for r in range(1, 6):
        ws.append([r, 'x', r * 1.5])
    wb.create_sheet('Two')['A1'] = 'hello'
    wb.save('plain.xlsx')


if __name__ == '__main__':
    pngs()
    names = ('in7', 'in8', 'in9', 'plain')
    pictures_and_chart(); five_charts(); shapes(); plain()
    for n in names:
        subprocess.run(['soffice', '--headless', '--convert-to', 'xls', n + '.xlsx'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
        print(n + '.xlsx ->', n + '.xls')
