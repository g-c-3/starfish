# Makes the two app icons from the logo artwork (Decision 539): branding/icon-light.png (white, copied to resources/icon.png) and branding/icon-dark.png.
# Usage: python3 make_icons.py [repo_dir]   Needs pillow. Not part of the app or of CI.
import sys, os
from PIL import Image

repo = sys.argv[1] if len(sys.argv) > 1 else '.'
SIZE = 1024; SHARE = 0.66  # the logo is 66 percent of the icon's width: inside the adaptive-icon safe zone after the generator's inset
src = Image.open(os.path.join(repo, 'branding', 'logo-A-sunset.png')).convert('RGBA')
box = src.getchannel('A').point(lambda v: 255 if v > 8 else 0).getbbox()
logo = src.crop(box); k = SIZE * SHARE / max(logo.size)
logo = logo.resize((round(logo.width * k), round(logo.height * k)), Image.LANCZOS)
for name, bg in (('icon-light.png', (255, 255, 255, 255)), ('icon-dark.png', (18, 18, 20, 255))):
    im = Image.new('RGBA', (SIZE, SIZE), bg); im.alpha_composite(logo, ((SIZE - logo.width) // 2, (SIZE - logo.height) // 2))
    im.convert('RGB').save(os.path.join(repo, 'branding', name))
Image.open(os.path.join(repo, 'branding', 'icon-light.png')).save(os.path.join(repo, 'resources', 'icon.png'))
