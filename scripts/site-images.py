"""Gera as imagens da landing page (site/img/) a partir das capturas de docs/assets/screenshots/.

  python scripts/site-images.py

Os originais nao sao alterados. Para cada captura saem webp em tres larguras (srcset) e um png
reduzido como fallback. Precisa do Pillow (`pip install pillow`).
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "docs" / "assets" / "screenshots"
OUT = ROOT / "site" / "img"

# nome: larguras do srcset (a maior nunca passa do original)
PLAN = {
    "dashboard": (640, 960, 1280),
    "dashboard-en": (640, 960, 1280),
    "dashboard-mobile": (390,),
    "dashboard-mobile-en": (390,),
    "rotinas": (640, 960, 1280),
    "modal-agente": (640, 960, 1280),
    "modal-script": (640, 960, 1280),
    "ajustes": (640, 960, 1280),
    "modal-agente-en": (640, 960, 1280),
    "modal-script-en": (640, 960, 1280),
    "ajustes-en": (640, 960, 1280),
    "rotinas-mobile": (390,),
}
FALLBACK_WIDTH = {"rotinas-mobile": 390, "dashboard-mobile": 390, "dashboard-mobile-en": 390, "login-card": 680}
# recorte (nome de saida: origem, caixa) para o fundo do fecho: so o cartao de senha, sem o titulo
CROPS = {"login-card": ("login", (600, 0, 1280, 900))}


def resize(im: Image.Image, width: int) -> Image.Image:
    if width >= im.width:
        return im.copy()
    height = round(im.height * width / im.width)
    return im.resize((width, height), Image.Resampling.LANCZOS)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for name, (source, box) in CROPS.items():
        Image.open(SRC / f"{source}.png").convert("RGB").crop(box).save(OUT / f"{name}.png", "PNG", optimize=True)
        PLAN[name] = (680,)
    for name, widths in PLAN.items():
        im = Image.open((OUT if name in CROPS else SRC) / f"{name}.png").convert("RGB")
        for w in widths:
            out = OUT / f"{name}-{w}.webp"
            resize(im, w).save(out, "WEBP", quality=82, method=6)
            print(f"{out.relative_to(ROOT)}  {out.stat().st_size // 1024} KB")
        fw = FALLBACK_WIDTH.get(name, 960)
        png = OUT / f"{name}.png"
        resize(im, fw).quantize(colors=256, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.FLOYDSTEINBERG).save(
            png, "PNG", optimize=True
        )
        print(f"{png.relative_to(ROOT)}  {png.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
