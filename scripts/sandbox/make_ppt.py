"""Builds sample presentations with python-pptx and converts them to the old .ppt format with the office suite.
Usage: python3 make_ppt.py [outdir]   (default /tmp/arkly-samples). Needs: python-pptx, pillow, soffice.
"""
import os
import subprocess
import sys
from PIL import Image, ImageDraw
from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.shapes import MSO_SHAPE, MSO_CONNECTOR
from pptx.enum.text import PP_ALIGN
from pptx.util import Inches
from pptx.util import Inches, Pt
from pptx.util import Pt, Inches
OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp/arkly-samples'
os.makedirs(OUT, exist_ok=True)
os.chdir(OUT)


def pngs():  # the two pictures the picture samples use
    from PIL import Image, ImageDraw
    im = Image.new('RGB', (300, 200), 'white'); d = ImageDraw.Draw(im); d.rectangle([0, 0, 149, 99], fill='red'); d.rectangle([150, 100, 299, 199], fill='blue'); d.ellipse([100, 50, 200, 150], fill='green')
    im.save('a.png'); im.save('b.jpg', quality=90)


def styled():
    p = Presentation(); p.slide_width=Inches(10); p.slide_height=Inches(7.5)
    s = p.slides.add_slide(p.slide_layouts[1])
    t = s.shapes.title.text_frame; t.text=''
    r = t.paragraphs[0].add_run(); r.text='Styled '; r.font.bold=True
    r2 = t.paragraphs[0].add_run(); r2.text='Title'; r2.font.color.rgb=RGBColor(0xC0,0,0); r2.font.size=Pt(36)
    b = s.placeholders[1].text_frame; b.clear()
    pa = b.paragraphs[0]
    for txt,kw in [('Plain ',{}),('bold red ',{'b':1,'c':RGBColor(0xFF,0,0)}),('italic',{'i':1})]:
        r = pa.add_run(); r.text=txt; r.font.size=Pt(24)
        if kw.get('b'): r.font.bold=True
        if kw.get('i'): r.font.italic=True
        if kw.get('c'): r.font.color.rgb=kw['c']
    p2 = b.add_paragraph(); p2.level=1; r=p2.add_run(); r.text='Second level item'; r.font.size=Pt(18)
    p3 = b.add_paragraph(); p3.alignment=PP_ALIGN.CENTER; r=p3.add_run(); r.text='Centered Courier'; r.font.name='Courier New'; r.font.size=Pt(20)
    tb = s.shapes.add_textbox(Inches(1),Inches(5.5),Inches(8),Inches(1.5)).text_frame
    q = tb.paragraphs[0]; q.line_spacing=1.5; q.space_before=Pt(12); q.alignment=PP_ALIGN.RIGHT
    r=q.add_run(); r.text='Underlined right text'; r.font.underline=True; r.font.size=Pt(30); r.font.name='Times New Roman'
    p.save(os.path.join(OUT, 'in.pptx'))



def long_body():
    p = Presentation(); p.slide_width=Inches(10); p.slide_height=Inches(7.5)
    s = p.slides.add_slide(p.slide_layouts[1]); s.shapes.title.text='Long body'
    b = s.placeholders[1].text_frame; b.clear()
    for i in range(14):
        pa = b.paragraphs[0] if i==0 else b.add_paragraph()
        r = pa.add_run(); r.text='Item %d with a fairly long line of text that will wrap across the placeholder width easily'%i
        if i==2: pa.alignment=PP_ALIGN.JUSTIFY
        if i==3:
            r2=pa.add_run(); r2.text='2'; r2.font._element.set('baseline','30000')
    tb=s.shapes.add_textbox(Inches(1),Inches(6.5),Inches(8),Inches(0.8)).text_frame; tb.word_wrap=True
    tb.text='Line one\vLine two after soft break'
    p.save(os.path.join(OUT, 'in2.pptx'))



def pictures():
    im = Image.new('RGB',(300,200),'white'); d=ImageDraw.Draw(im); d.rectangle([0,0,149,99],fill='red'); d.rectangle([150,100,299,199],fill='blue'); d.ellipse([100,50,200,150],fill='green')
    im.save('a.png'); im.save('b.jpg', quality=90)
    p = Presentation(); p.slide_width=Inches(10); p.slide_height=Inches(7.5)
    s = p.slides.add_slide(p.slide_layouts[6])
    s.shapes.add_picture('a.png', Inches(0.5), Inches(0.5), Inches(3), Inches(2))
    pc = s.shapes.add_picture('b.jpg', Inches(4.5), Inches(0.5), Inches(3), Inches(2)); pc.crop_left=0.5; pc.crop_top=0.5
    pr = s.shapes.add_picture('a.png', Inches(1), Inches(4), Inches(3), Inches(2)); pr.rotation=20
    pl = s.shapes.add_picture('b.jpg', Inches(5.5), Inches(4), Inches(3), Inches(2)); pl.line.width=Inches(0.05); pl.line.color.rgb=__import__('pptx.dml.color',fromlist=['RGBColor']).RGBColor(255,0,255)
    p.save(os.path.join(OUT, 'in3.pptx'))



def master_bg():
    p = Presentation(); p.slide_width=Inches(10); p.slide_height=Inches(7.5)
    m = p.slide_master
    tmp = p.slides.add_slide(p.slide_layouts[6])
    bar = tmp.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, Inches(7), Inches(10), Inches(0.5)); bar.fill.solid(); bar.fill.fore_color.rgb=RGBColor(0x1F,0x4E,0x79); bar.line.fill.background()
    pic = tmp.shapes.add_picture('a.png', Inches(8.3), Inches(0.1), Inches(1.5), Inches(1))
    ip, rid = m.part.get_or_add_image_part('a.png')
    pic._element.blipFill.blip.set('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}embed', rid)
    m.shapes._spTree.append(bar._element); m.shapes._spTree.append(pic._element)
    ids = p.slides._sldIdLst; sid = ids[0]; p.part.drop_rel(sid.rId); ids.remove(sid)
    m.background.fill.solid(); m.background.fill.fore_color.rgb = RGBColor(0xFF,0xF2,0xCC)
    s1 = p.slides.add_slide(p.slide_layouts[5]); s1.shapes.title.text='Master background'
    s2 = p.slides.add_slide(p.slide_layouts[5]); s2.shapes.title.text='Own gradient'
    f = s2.background.fill; f.gradient(); f.gradient_angle = 90
    f.gradient_stops[0].color.rgb = RGBColor(255,0,0); f.gradient_stops[1].color.rgb = RGBColor(0,0,255)
    s3 = p.slides.add_slide(p.slide_layouts[5]); s3.shapes.title.text='Own solid'
    s3.background.fill.solid(); s3.background.fill.fore_color.rgb = RGBColor(0x20,0x20,0x40)
    p.save(os.path.join(OUT, 'in4.pptx'))



def gradients():
    p = Presentation(); p.slide_width=Inches(10); p.slide_height=Inches(7.5)
    for a in (0, 45, 90, 135, 270):
        s = p.slides.add_slide(p.slide_layouts[6]); f = s.background.fill; f.gradient(); f.gradient_angle = a
        f.gradient_stops[0].color.rgb = RGBColor(255,0,0); f.gradient_stops[1].color.rgb = RGBColor(0,0,255)
    p.save(os.path.join(OUT, 'in5.pptx'))



def freeforms():
    p = Presentation(); p.slide_width=Inches(10); p.slide_height=Inches(7.5)
    s = p.slides.add_slide(p.slide_layouts[6])
    fb = s.shapes.build_freeform(Inches(1), Inches(1)); fb.add_line_segments([(Inches(3),Inches(1.5)),(Inches(2.5),Inches(3)),(Inches(1.2),Inches(2.6))], close=True)
    ff = fb.convert_to_shape(); ff.fill.solid(); ff.fill.fore_color.rgb=RGBColor(0,160,80); ff.line.color.rgb=RGBColor(0,0,0); ff.line.width=Pt(3)
    c1 = s.shapes.add_connector(MSO_CONNECTOR.STRAIGHT, Inches(4), Inches(1), Inches(8), Inches(1)); c1.line.width=Pt(4); c1.line.color.rgb=RGBColor(200,0,0)
    c2 = s.shapes.add_connector(MSO_CONNECTOR.STRAIGHT, Inches(4), Inches(3), Inches(8), Inches(1.5)); c2.line.width=Pt(2); c2.line.color.rgb=RGBColor(0,0,200)
    rr = s.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(1), Inches(4), Inches(3), Inches(2)); rr.adjustments[0]=0.4; rr.fill.solid(); rr.fill.fore_color.rgb=RGBColor(255,200,0)
    vl = s.shapes.add_connector(MSO_CONNECTOR.STRAIGHT, Inches(6), Inches(3.5), Inches(6), Inches(6.5)); vl.line.width=Pt(3)
    fb2 = s.shapes.build_freeform(Inches(7), Inches(4)); fb2.add_line_segments([(Inches(9),Inches(4.5)),(Inches(8),Inches(6))], close=False)
    f2 = fb2.convert_to_shape(); f2.fill.background(); f2.line.color.rgb=RGBColor(120,0,120); f2.line.width=Pt(3)
    p.save(os.path.join(OUT, 'in6.pptx'))



if __name__ == '__main__':
    pngs()
    for f in (styled, long_body, pictures, master_bg, gradients, freeforms):
        f()
    for _, o in (('styled', 'in.pptx'), ('long_body', 'in2.pptx'), ('pictures', 'in3.pptx'), ('master_bg', 'in4.pptx'), ('gradients', 'in5.pptx'), ('freeforms', 'in6.pptx')):
        subprocess.run(['soffice', '--headless', '--convert-to', 'ppt', o], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
        print(o, '->', o.replace('.pptx', '.ppt'))
