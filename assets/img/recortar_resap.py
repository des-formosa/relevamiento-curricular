"""Recorta el logo de ReSaP de la placa oficial (resap-original.png) y le saca el fondo.

Genera, en esta misma carpeta:
  resap-simbolo.png     el portapapeles con el libro. Solo se vuelve transparente
                        el blanco que toca el borde: la hoja queda blanca
  resap-palabra.png     «ReSaP», con todo el blanco transparente, también el de
                        adentro de las letras (si no, sobre un fondo gris se ven
                        cuadraditos blancos)
  resap-icono.png       el símbolo en 64 × 64, para la pestaña del navegador
  resap-icono-180.png   el mismo en 180 × 180, para el acceso directo del celular
  resap-compartir.jpg   1200 × 630, la vista previa cuando se comparte el link
                        (WhatsApp, Facebook, Telegram): los logos del Ministerio y
                        la DES arriba y la placa de ReSaP debajo

Si llega un original con otra composición, hay que revisar las dos cajas de
recorte de abajo. Uso: python assets/img/recortar_resap.py (necesita Pillow).
"""
import pathlib
from collections import deque

from PIL import Image, ImageChops, ImageFilter

CARPETA = pathlib.Path(__file__).resolve().parent
MARGEN = 6          # px de aire alrededor de lo recortado
UMBRAL_BLANCO = 235  # un píxel con todos sus canales por encima de esto es fondo

original = Image.open(CARPETA / 'resap-original.png').convert('RGB')


def caja_sin_blanco(img):
    w, h = img.size
    px = img.load()
    xs = [x for x in range(w) for y in range(0, h, 2) if min(px[x, y]) < UMBRAL_BLANCO]
    ys = [y for y in range(h) for x in range(0, w, 2) if min(px[x, y]) < UMBRAL_BLANCO]
    return min(xs), min(ys), max(xs) + 1, max(ys) + 1


def sin_fondo(img, todo=False):
    """Vuelve transparente el blanco. Con todo=False, solo el que está conectado
    con el borde. El borde suavizado se «desmultiplica» contra blanco para que no
    quede un halo claro."""
    w, h = img.size
    px = img.load()
    fondo = Image.new('L', (w, h), 0)
    f = fondo.load()
    cola = deque((x, y) for x in range(w) for y in (0, h - 1))
    cola.extend((x, y) for y in range(h) for x in (0, w - 1))
    while cola:
        x, y = cola.popleft()
        if f[x, y] or min(px[x, y]) < UMBRAL_BLANCO:
            continue
        f[x, y] = 255
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = x + dx, y + dy
            if 0 <= nx < w and 0 <= ny < h and not f[nx, ny]:
                cola.append((nx, ny))
    zona = fondo.filter(ImageFilter.MaxFilter(5)).load()
    salida = Image.new('RGBA', (w, h))
    o = salida.load()
    for y in range(h):
        for x in range(w):
            r, g, b = px[x, y]
            if todo or zona[x, y]:
                a = max(255 - r, 255 - g, 255 - b) / 255
                if a < 0.03:
                    o[x, y] = (0, 0, 0, 0)
                    continue
                o[x, y] = tuple(max(0, min(255, round((c - 255 * (1 - a)) / a))) for c in (r, g, b)) + (round(a * 255),)
            else:
                o[x, y] = (r, g, b, 255)
    return salida


def recortar(caja, nombre, alto, todo=False):
    parte = original.crop(caja)
    x0, y0, x1, y1 = caja_sin_blanco(parte)
    parte = parte.crop((max(0, x0 - MARGEN), max(0, y0 - MARGEN), min(parte.width, x1 + MARGEN), min(parte.height, y1 + MARGEN)))
    limpia = sin_fondo(parte, todo=todo)
    final = limpia.resize((round(limpia.width * alto / limpia.height), alto), Image.LANCZOS)
    final.save(CARPETA / f'{nombre}.png', optimize=True)
    print(nombre, '->', final.size)
    return final


# Cajas sobre la placa de 1825 × 862: el símbolo a la izquierda, la palabra arriba a la derecha
simbolo = recortar((40, 40, 700, 720), 'resap-simbolo', 240)
recortar((700, 90, 1640, 360), 'resap-palabra', 150, todo=True)

lado = max(simbolo.size)
cuadro = Image.new('RGBA', (lado, lado))
cuadro.paste(simbolo, ((lado - simbolo.width) // 2, (lado - simbolo.height) // 2))
cuadro.resize((64, 64), Image.LANCZOS).save(CARPETA / 'resap-icono.png', optimize=True)
cuadro.resize((180, 180), Image.LANCZOS).save(CARPETA / 'resap-icono-180.png', optimize=True)

# Vista previa para compartir: 1200 × 630 es la proporción que WhatsApp muestra
# grande. En JPG y liviana: con más de 300 KB algunos celulares no la bajan.
ANCHO, ALTO = 1200, 630
lienzo = Image.new('RGB', (ANCHO, ALTO), (255, 255, 255))
logos = [Image.open(CARPETA / 'logo-ministerio.webp').convert('RGB'), Image.open(CARPETA / 'logo-secundaria.webp').convert('RGB')]
alto_logo = 96
logos = [l.resize((round(l.width * alto_logo / l.height), alto_logo), Image.LANCZOS) for l in logos]
separacion = 44
x = (ANCHO - sum(l.width for l in logos) - separacion) // 2
for i, l in enumerate(logos):
    lienzo.paste(l, (x, 26))
    x += l.width + separacion
    if i == 0:
        for y in range(40, 26 + alto_logo - 14):
            lienzo.putpixel((x - separacion // 2, y), (222, 227, 235))
placa = original.copy()
# El fondo de la placa no es blanco parejo: tiene zonas gris azuladas muy
# claras que sobre el lienzo blanco dibujan un recuadro. Lo casi blanco, a blanco.
r, g, b = placa.split()
casi_blanco = ImageChops.darker(ImageChops.darker(r, g), b).point(lambda v: 255 if v >= 236 else 0)
placa.paste((255, 255, 255), mask=casi_blanco)
arriba = 26 + alto_logo + 18
lugar = (ANCHO - 80, ALTO - arriba - 24)
escala = min(lugar[0] / placa.width, lugar[1] / placa.height)
placa = placa.resize((round(placa.width * escala), round(placa.height * escala)), Image.LANCZOS)
lienzo.paste(placa, ((ANCHO - placa.width) // 2, arriba + (lugar[1] - placa.height) // 2))
lienzo.save(CARPETA / 'resap-compartir.jpg', quality=86, optimize=True, progressive=True)
print('resap-compartir ->', lienzo.size, round((CARPETA / 'resap-compartir.jpg').stat().st_size / 1024), 'KB')
