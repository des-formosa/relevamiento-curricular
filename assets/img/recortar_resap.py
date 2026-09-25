"""Recorta el logo de ReSaP de la placa oficial (resap-original.png) y le saca el fondo.

Genera, en esta misma carpeta:
  resap-simbolo.png     el portapapeles con el libro. Solo se vuelve transparente
                        el blanco que toca el borde: la hoja queda blanca
  resap-palabra.png     «ReSaP», con todo el blanco transparente, también el de
                        adentro de las letras (si no, sobre un fondo gris se ven
                        cuadraditos blancos)
  resap-icono.png       el símbolo en 64 × 64, para la pestaña del navegador
  resap-icono-180.png   el mismo en 180 × 180, para el acceso directo del celular
  resap-compartir.jpg        vista previa al compartir el link del formulario
                             (WhatsApp, Facebook, Telegram): 1200 × 630, con
                             filete tricolor
  resap-compartir-panel.jpg  la misma, para el link del panel: para que no se
                             confundan a simple vista, lleva una etiqueta
                             («Equipo de Planificación Curricular») y una
                             barra azul en vez del filete tricolor, que es
                             del formulario

Las dos vistas previas escriben el nombre con la tipografía de la marca
(Kumbh Sans), no con la placa: al tamaño tan chico en que se ve una vista
previa, el texto de la placa se lee borroso. La fuente es variable y
Pillow no lee woff2, así que se convierte a ttf al vuelo con fontTools.

Si llega un original con otra composición, hay que revisar las dos cajas de
recorte de abajo. Uso: python assets/img/recortar_resap.py
(necesita Pillow y fontTools: pip install pillow fonttools).
"""
import io
import pathlib
from collections import deque

from fontTools.ttLib import TTFont
from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

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

# ----------------------------------------------------------------------------
# Vista previa al compartir el link (WhatsApp, Facebook, Telegram)
# ----------------------------------------------------------------------------
# 1200 × 630 es la proporción que se ve grande. Pocos elementos, grandes: a
# ese tamaño la vista previa se ve como una miniatura chica en la lista de
# chats, y la placa entera (con la letra chica del eslogan) se leía borrosa.
# El nombre completo, el título y el eslogan del docente ya van como texto
# real en las etiquetas Open Graph (og:title, og:description); la imagen no
# los repite, así que no hace falta apretar tanto texto en ella.
ANCHO, ALTO = 1200, 630
MARGEN_LATERAL = 64
AZUL = (0, 51, 128)
LADRILLO = (177, 74, 18)
CELESTE, VERDE, AMARILLO = (0, 148, 249), (73, 168, 48), (254, 181, 1)


def _fuente_kumbh(peso, tamano):
    """Kumbh Sans es variable y Pillow no lee woff2: se convierte una vez, en
    memoria, y se pide el peso (400 regular, 500 medio, 800 bold)."""
    origen = TTFont(CARPETA / '..' / 'fuentes' / 'kumbh-sans-latin.woff2')
    origen.flavor = None
    buffer = io.BytesIO()
    origen.save(buffer)
    buffer.seek(0)
    fuente = ImageFont.truetype(buffer, tamano)
    fuente.set_variation_by_axes([peso])
    return fuente


def _icono_grande(alto):
    """El símbolo (portapapeles + libro), recortado a mayor resolución que el
    resap-simbolo.png chico de la cabecera, para que no se vea borroso acá."""
    parte = original.crop((40, 40, 700, 720))
    x0, y0, x1, y1 = caja_sin_blanco(parte)
    parte = parte.crop((max(0, x0 - MARGEN), max(0, y0 - MARGEN), min(parte.width, x1 + MARGEN), min(parte.height, y1 + MARGEN)))
    limpia = sin_fondo(parte)
    return limpia.resize((round(limpia.width * alto / limpia.height), alto), Image.LANCZOS)


def _palabra_grande(alto):
    """«ReSaP», recortada a mayor resolución que resap-palabra.png."""
    parte = original.crop((700, 90, 1640, 360))
    x0, y0, x1, y1 = caja_sin_blanco(parte)
    parte = parte.crop((max(0, x0 - MARGEN), max(0, y0 - MARGEN), min(parte.width, x1 + MARGEN), min(parte.height, y1 + MARGEN)))
    limpia = sin_fondo(parte, todo=True)
    return limpia.resize((round(limpia.width * alto / limpia.height), alto), Image.LANCZOS)


def _lienzo_base():
    """Lo que comparten las dos vistas previas: fondo blanco y los logos del
    Ministerio y de la DES arriba, centrados."""
    lienzo = Image.new('RGB', (ANCHO, ALTO), (255, 255, 255))
    logos = [Image.open(CARPETA / 'logo-ministerio.webp').convert('RGB'), Image.open(CARPETA / 'logo-secundaria.webp').convert('RGB')]
    alto_logo = 92
    logos = [l.resize((round(l.width * alto_logo / l.height), alto_logo), Image.LANCZOS) for l in logos]
    separacion = 40
    x = (ANCHO - sum(l.width for l in logos) - separacion) // 2
    for i, l in enumerate(logos):
        lienzo.paste(l, (x, 30))
        x += l.width + separacion
        if i == 0:
            for y in range(44, 30 + alto_logo - 12):
                lienzo.putpixel((x - separacion // 2, y), (222, 227, 235))
    return lienzo


def _vista_previa(nombre, etiqueta=None, color_barra='tricolor'):
    """Arma una vista previa: logos, el símbolo con «ReSaP» y el nombre
    completo al lado, y una barra abajo. Con etiqueta, va arriba del lockup
    (así se distingue el link del panel a simple vista, sin leer el texto)."""
    lienzo = _lienzo_base()
    d = ImageDraw.Draw(lienzo)
    icono = _icono_grande(232)
    palabra = _palabra_grande(118)
    f_nombre_bold = _fuente_kumbh(800, 42)
    f_nombre_medio = _fuente_kumbh(500, 42)
    lineas = [('Relevamiento y Sistematización', f_nombre_bold), ('de Saberes Prioritarios', f_nombre_bold), ('del Nivel Secundario.', f_nombre_medio)]
    interlineado = 8
    alturas = [d.textbbox((0, 0), t, font=f)[3] for t, f in lineas]
    alto_texto = sum(alturas) + interlineado * (len(lineas) - 1)
    gap_palabra_texto = 18
    alto_lockup = palabra.height + gap_palabra_texto + alto_texto
    y_lockup = 178 if not etiqueta else 214
    x_icono = MARGEN_LATERAL
    y_icono = y_lockup + (alto_lockup - icono.height) // 2
    lienzo.paste(icono, (x_icono, y_icono), icono)
    x_texto = x_icono + icono.width + 36
    lienzo.paste(palabra, (x_texto, y_lockup), palabra)
    y = y_lockup + palabra.height + gap_palabra_texto
    ancho_texto = 0
    for (t, f), alto_linea in zip(lineas, alturas):
        caja = d.textbbox((0, 0), t, font=f)
        d.text((x_texto, y - caja[1]), t, font=f, fill=AZUL)
        ancho_texto = max(ancho_texto, caja[2] - caja[0])
        y += alto_linea + interlineado
    if etiqueta:
        f_etq = _fuente_kumbh(800, 24)
        d.text((x_texto, y_lockup - 40), etiqueta.upper(), font=f_etq, fill=LADRILLO)
    y_barra = y + 14
    x1_barra = x_texto + ancho_texto
    if color_barra == 'tricolor':
        tercio = (x1_barra - x_texto) / 3
        for i, color in enumerate((CELESTE, VERDE, AMARILLO)):
            d.rectangle([x_texto + tercio * i, y_barra, x_texto + tercio * (i + 1), y_barra + 7], fill=color)
    else:
        d.rectangle([x_texto, y_barra, x1_barra, y_barra + 7], fill=color_barra)
    return lienzo


docente = _vista_previa('resap-compartir')
docente.save(CARPETA / 'resap-compartir.jpg', quality=88, optimize=True, progressive=True)
print('resap-compartir ->', docente.size, round((CARPETA / 'resap-compartir.jpg').stat().st_size / 1024), 'KB')

panel = _vista_previa('resap-compartir-panel', etiqueta='Equipo de Planificación Curricular', color_barra=AZUL)
panel.save(CARPETA / 'resap-compartir-panel.jpg', quality=88, optimize=True, progressive=True)
print('resap-compartir-panel ->', panel.size, round((CARPETA / 'resap-compartir-panel.jpg').stat().st_size / 1024), 'KB')
