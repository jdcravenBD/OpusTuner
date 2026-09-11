"""
Bring the purchase-screen pictures into the app, at a size it can use.

Straight off a phone they are 1170 wide, and the widest they are ever drawn
here is about 180 CSS pixels -- 540 device pixels on a 3x screen. Shipping the
originals would be a megabyte of detail nothing renders.
"""
import io
import os
from PIL import Image

SRC = r'C:\Users\Joe\Desktop\eatpurscreens'
DST = 'public/showcase'

# Ordered, and named for what each one is of. Two of the eight are the same
# screen twice (see the note in showcase.ts).
PLAN = [
    ('IMG_8078.jpeg', 'modern-dark.jpg'),
    ('IMG_8079.jpeg', 'modern-light.jpg'),
    ('IMG_8080.jpeg', 'light-green.jpg'),
    ('IMG_8081.jpeg', 'dark-green.jpg'),
    ('IMG_8084.jpeg', 'light-pared.jpg'),
    ('IMG_8083.jpeg', 'dark-bare.jpg'),
    ('IMG_8085.jpeg', 'dark-fewer-marks.jpg'),
    ('IMG_8082.jpeg', 'modern-dark-2.jpg'),
]

# 3x the widest the card is ever drawn, with room to spare.
WIDTH = 600

os.makedirs(DST, exist_ok=True)
total = 0
for src, out in PLAN:
    path = os.path.join(SRC, src)
    im = Image.open(path)
    assert im.width == 1170, '%s is %dpx wide, not 1170' % (src, im.width)
    h = round(im.height * WIDTH / im.width)
    im = im.convert('RGB').resize((WIDTH, h), Image.LANCZOS)
    dest = os.path.join(DST, out)
    im.save(dest, 'JPEG', quality=82, optimize=True, progressive=True)
    size = os.path.getsize(dest)
    total += size
    print('%-22s %4dx%-4d %6.1f kB' % (out, WIDTH, h, size / 1024))

print('total %.0f kB across %d files' % (total / 1024, len(PLAN)))
