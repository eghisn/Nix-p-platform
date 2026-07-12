from pathlib import Path
from collections import deque
from PIL import Image, ImageChops, ImageOps

ROOT = Path(__file__).resolve().parents[1]
PAPER = (241, 241, 241, 255)
CANVAS = 1600
TARGET = 1320

ASSETS = [
    ("public/release-photos/nxp-2026-cd-0007-model-actriz-pirouette-cd.jpg", "public/display-photos/nxp-2026-cd-0007-model-actriz-pirouette-cd.png", TARGET),
    ("public/release-photos/nxp-2026-cd-0008-daniel-lopatin-marty-supreme-cd.jpg", "public/display-photos/nxp-2026-cd-0008-daniel-lopatin-marty-supreme-cd.png", TARGET),
    ("public/release-photos/nxp-2026-cd-0009-sophie-sophie-cd.png", "public/display-photos/nxp-2026-cd-0009-sophie-sophie-cd.png", TARGET),
    ("public/release-photos/nxp-2026-cst-0008-facs-wish-defense-cassette-paper.png", "public/display-photos/nxp-2026-cst-0008-facs-wish-defense-cassette.png", TARGET),
    ("public/release-photos/nxp-2026-cst-0009-peggy-gou-i-hear-you-cassette.jpg", "public/display-photos/nxp-2026-cst-0009-peggy-gou-i-hear-you-cassette.png", TARGET),
    ("public/release-photos/nxp-2026-vnl-0001-squarepusher-kammerkonzert-vinyl.jpg", "public/display-photos/nxp-2026-vnl-0001-squarepusher-kammerkonzert-vinyl.png", TARGET),
    ("public/release-photos/nxp-2026-vnl-0002-melt-banana-35-vinyl.webp", "public/display-photos/nxp-2026-vnl-0002-melt-banana-35-vinyl.png", TARGET),
    ("public/release-photos/nxp-2026-vnl-0003-nala-sinephro-endlessness-vinyl.jpg", "public/display-photos/nxp-2026-vnl-0003-nala-sinephro-endlessness-vinyl.png", TARGET),
    ("public/release-photos/nxp-2026-vnl-0004-girl-band-the-talkies-vinyl.webp", "public/display-photos/nxp-2026-vnl-0004-girl-band-the-talkies-vinyl.png", TARGET),
    ("public/release-photos/nxp-2026-vnl-0005-gilla-band-the-early-years-vinyl.jpg", "public/display-photos/nxp-2026-vnl-0005-gilla-band-the-early-years-vinyl.png", TARGET),
    ("public/release-photos/nxp-2026-vnl-0007-hiatus-kaiyote-love-heart-cheat-code-vinyl.jpg", "public/display-photos/nxp-2026-vnl-0007-hiatus-kaiyote-love-heart-cheat-code-vinyl.png", TARGET),
    ("public/release-photos/nxp-2026-vnl-0008-arca-andandandandand-vinyl.jpg", "public/display-photos/nxp-2026-vnl-0008-arca-andandandandand-vinyl.png", 1500),
    ("public/release-photos/nxp-2026-vnl-0009-panda-bear-buoys-vinyl.jpg", "public/display-photos/nxp-2026-vnl-0009-panda-bear-buoys-vinyl.png", TARGET),
    ("public/release-photos/nxp-2026-vnl-0010-overmono-the-streets-turn-the-page-vinyl.png", "public/display-photos/nxp-2026-vnl-0010-overmono-the-streets-turn-the-page-vinyl.png", TARGET),
    ("public/release-photos/nxp-2026-vnl-0011-heith-tarawangsawelas-duori-vinyl.jpg", "public/display-photos/nxp-2026-vnl-0011-heith-tarawangsawelas-duori-vinyl.png", TARGET),
    ("public/release-photos/nxp-2026-vnl-0012-blawan-sickelixir-vinyl.jpg", "public/display-photos/nxp-2026-vnl-0012-blawan-sickelixir-vinyl.png", TARGET),
    ("public/motorith-crewneck-sweatshirt-2023-transparent.png", "public/display-photos/motorith-crewneck-sweatshirt-2023.png", TARGET),
]


def background_bbox(img):
    rgba = img.convert("RGBA")
    alpha = rgba.getchannel("A")
    if alpha.getbbox():
        opaque = alpha.point(lambda value: 255 if value > 16 else 0)
        bbox = opaque.getbbox()
        if bbox and bbox != (0, 0, img.width, img.height):
            return bbox

    rgb = rgba.convert("RGB")
    points = [
        rgb.getpixel((0, 0)),
        rgb.getpixel((img.width - 1, 0)),
        rgb.getpixel((0, img.height - 1)),
        rgb.getpixel((img.width - 1, img.height - 1)),
        rgb.getpixel((img.width // 2, 0)),
        rgb.getpixel((img.width // 2, img.height - 1)),
        rgb.getpixel((0, img.height // 2)),
        rgb.getpixel((img.width - 1, img.height // 2)),
    ]
    bg = tuple(round(sum(point[i] for point in points) / len(points)) for i in range(3))
    matte = Image.new("RGB", rgb.size, bg)
    diff = ImageChops.difference(rgb, matte).convert("L")
    mask = diff.point(lambda value: 255 if value > 18 else 0)
    bbox = mask.getbbox()
    return bbox or (0, 0, img.width, img.height)


def normalize(src, dest, target=TARGET):
    img = Image.open(src).convert("RGBA")
    bbox = background_bbox(img)
    crop = img.crop(bbox)
    crop = blend_light_background(crop)

    # Keep a little source shadow around the object while removing empty canvas.
    crop = ImageOps.expand(crop, border=max(10, round(max(crop.size) * 0.025)), fill=(255, 255, 255, 0))
    scale = min(target / crop.width, target / crop.height)
    size = (max(1, round(crop.width * scale)), max(1, round(crop.height * scale)))
    crop = crop.resize(size, Image.Resampling.LANCZOS)

    canvas = Image.new("RGBA", (CANVAS, CANVAS), PAPER)
    x = (CANVAS - crop.width) // 2
    y = (CANVAS - crop.height) // 2
    canvas.alpha_composite(crop, (x, y))
    dest.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(dest, "PNG", optimize=True)
    return dest, bbox, size


def blend_light_background(img):
    rgba = img.convert("RGBA")
    pixels = rgba.load()
    seen = set()
    queue = deque()

    def is_light_background(x, y):
        r, g, b, a = pixels[x, y]
        return a and r > 214 and g > 214 and b > 214 and max(r, g, b) - min(r, g, b) < 36

    for x in range(rgba.width):
        for y in (0, rgba.height - 1):
            if is_light_background(x, y):
                queue.append((x, y))
                seen.add((x, y))
    for y in range(rgba.height):
        for x in (0, rgba.width - 1):
            if (x, y) not in seen and is_light_background(x, y):
                queue.append((x, y))
                seen.add((x, y))

    while queue:
        x, y = queue.popleft()
        pixels[x, y] = PAPER
        for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
            if 0 <= nx < rgba.width and 0 <= ny < rgba.height and (nx, ny) not in seen and is_light_background(nx, ny):
                seen.add((nx, ny))
                queue.append((nx, ny))
    return rgba


for source, output, target in ASSETS:
    dest, bbox, size = normalize(ROOT / source, ROOT / output, target)
    print(f"{dest.relative_to(ROOT)} bbox={bbox} size={size}")
