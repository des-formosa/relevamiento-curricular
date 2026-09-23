#!/usr/bin/env python3
"""Convierte las grillas de saberes priorizados del equipo al catálogo.

    python datos/priorizados/convertir.py            reemplaza las materias en catalogo.json
    python datos/priorizados/convertir.py --revisar  informa y escribe revision.md, sin tocar nada

El equipo técnico arma los saberes priorizados en su propio Excel: una grilla,
no una fila por saber. Obligarlos a nuestro formato de importación fue lo que
no funcionó («me los carga pero los pone como la app quiere, no como yo lo
hago»). Así que este script lee la grilla tal como la hacen ellos.

Hay dos formatos, uno por materia, y cada uno tiene su lector:

- Lengua: una fila por eje, una columna por trimestre, un bloque por año.
- Matemática: una fila por saber, un par de columnas (saber, contenidos) por
  año, un bloque por trimestre. El eje no viene por saber sino por bloque, y
  nombra dos ejes a la vez («Geometría y medida - Números y operaciones»).

La materia se REEMPLAZA: los saberes viejos salen de catalogo.json. Al correr
sql/07_cargar_catalogo.sql, cargar_catalogo() borra los que nadie usó y archiva
los que ya tienen respuestas, que conservan sus datos.

Los id nuevos llevan «--pr-» para no reusar nunca el id de un saber viejo: si
el primer saber priorizado heredara «lengua--e1--a1s1», las respuestas que ya
tiene ese id pasarían a contarse para un saber que dice otra cosa.

ATENCIÓN: los id salen de la posición en la grilla. Hasta que arranque la
carga real se puede correr las veces que haga falta. Después, no: reordenar la
grilla movería los id y con ellos las respuestas. Una vez abierto el
relevamiento, las correcciones van por el panel.
"""
from __future__ import annotations

import json
import re
import sys
import unicodedata
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

AQUI = Path(__file__).resolve().parent
RAIZ = AQUI.parent.parent
CATALOGO = RAIZ / "datos" / "catalogo.json"
REVISION = AQUI / "revision.md"

NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
ORIGEN_CONTENIDO = "propuesto_equipo"
ORDINAL = {1: "1er", 2: "2do", 3: "3er"}


# ------------------------------------------------------------------ utilidades

def normalizar_texto(t: str) -> str:
    """Espejo exacto de normalizarTexto() en assets/normalizar.js."""
    t = unicodedata.normalize("NFD", (t or "").lower())
    t = "".join(c for c in t if unicodedata.category(c) != "Mn")
    return re.sub(r"[^a-z0-9]+", " ", t).strip()


def limpio(t: str) -> str:
    t = (t or "").replace("\xa0", " ")
    return re.sub(r"\s+", " ", t).strip()


def _columna(ref: str) -> int:
    n = 0
    for c in re.match(r"([A-Z]+)", ref).group(1):
        n = n * 26 + (ord(c) - 64)
    return n - 1


def leer_hoja(ruta: Path) -> list[list[str]]:
    """Primera hoja del .xlsx como filas de texto. Sin openpyxl: es un zip."""
    z = zipfile.ZipFile(ruta)
    textos: list[str] = []
    if "xl/sharedStrings.xml" in z.namelist():
        for si in ET.fromstring(z.read("xl/sharedStrings.xml")).findall(NS + "si"):
            textos.append("".join(t.text or "" for t in si.iter(NS + "t")))
    hojas = sorted(n for n in z.namelist() if re.match(r"xl/worksheets/sheet\d+\.xml$", n))
    filas = []
    for fila in ET.fromstring(z.read(hojas[0])).iter(NS + "row"):
        celdas: dict[int, str] = {}
        for c in fila.findall(NS + "c"):
            v = c.find(NS + "v")
            if c.get("t") == "s" and v is not None:
                valor = textos[int(v.text)]
            elif c.get("t") == "inlineStr":
                valor = "".join(t.text or "" for t in c.iter(NS + "t"))
            else:
                valor = v.text if v is not None else ""
            celdas[_columna(c.get("r"))] = valor or ""
        ancho = max(celdas) + 1 if celdas else 0
        filas.append([celdas.get(i, "") for i in range(max(ancho, 8))])
    return filas


ROMANOS = {"i": 1, "ii": 2, "iii": 3, "iv": 4, "v": 5}
TRIMESTRES = {"primer": 1, "segundo": 2, "tercer": 3}


# -------------------------------------------------- Lengua: eje × trimestre

def leer_grilla_ejes(ruta: Path, anteriores: list[dict] | None = None) -> tuple[list[dict], list[str]]:
    """Filas por eje, columnas B/C/D por trimestre, un bloque por año.

    El número de eje sale del romano («Eje II:»), no del nombre: en 1° año el
    Eje II dice «Lectura y Producción no escrita», que es una errata, y en 3°
    el nombre viene partido en dos filas («Lectura y Producción» / «Escrita»).
    """
    filas = leer_hoja(ruta)
    saberes: list[dict] = []
    notas: list[str] = []
    anio = eje = None
    ultimo_por_col: dict[int, dict] = {}

    for n, f in enumerate(filas, 1):
        a = limpio(f[0])
        if normalizar_texto(a) == "eje curricular":
            m = re.match(r"(\d)", limpio(f[1]))
            anio = int(m.group(1)) if m else None
            eje, ultimo_por_col = None, {}
            continue
        m = re.match(r"eje\s+([ivx]+)\b", normalizar_texto(a))
        if m:
            eje = ROMANOS[m.group(1)]
            ultimo_por_col = {}
        # «Escrita» en la columna A es la segunda línea del nombre del eje:
        # no abre un eje nuevo.

        for col, trimestre in ((1, 1), (2, 2), (3, 3)):
            texto = f[col].replace("\xa0", " ")
            if not texto.strip():
                continue
            # Una celda que arranca en minúscula es el resto de la de arriba,
            # cortada al pasarla a la planilla («…de un mis» / «mo autor.»).
            # Se pega tal cual, sin espacio: el corte fue en el medio de la palabra.
            if texto.strip()[0].islower() and col in ultimo_por_col:
                previo = ultimo_por_col[col]
                antes = previo["texto"]
                previo["texto"] = limpio(previo["crudo"] + texto)
                previo["crudo"] += texto
                notas.append(f"Lengua {anio}°, fila {n}: se unió con la celda de arriba → "
                             f"«…{previo['texto'][-45:]}» (antes terminaba en «…{antes[-20:]}»)")
                continue
            if anio is None or eje is None:
                notas.append(f"Lengua fila {n}: saber sin año o eje, se omitió: «{limpio(texto)[:60]}»")
                continue
            s = {"anio": anio, "trimestre": trimestre, "eje": eje, "texto": limpio(texto),
                 "crudo": texto, "contenidos": [], "fila": n}
            saberes.append(s)
            ultimo_por_col[col] = s

    for s in saberes:
        s.pop("crudo", None)
    return saberes, notas


# ---------------------------------------- Matemática: trimestre × año

# Cada bloque de la grilla nombra dos ejes juntos. Estas son las palabras con
# que se reconoce cuál de los ejes oficiales es cada uno.
EJES_MATEMATICA = {
    1: ("numero", "numeros", "operaciones"),
    2: ("algebra", "funciones"),
    3: ("geometria", "medida"),
    4: ("estadistica", "probabilidad"),
}

# Para decidir a cuál de los dos ejes del bloque va cada saber. Es lo único de
# este script que interpreta en vez de copiar, por eso todo lo que decide
# queda escrito en revision.md para que el equipo lo mire.
PISTAS = {
    1: ("numero", "numeros", "natural", "naturales", "entero", "enteros", "racional",
        "racionales", "fraccion", "fraccionaria", "decimal", "decimales", "operacion",
        "operaciones", "suma", "resta", "multiplicacion", "division", "calculo",
        "cantidades", "campos numericos", "divisores", "multiplos", "porcentaje"),
    2: ("algebra", "algebraica", "ecuacion", "ecuaciones", "incognita", "funcion",
        "funcional", "formula", "formulas", "variables", "variacion", "variaciones",
        "proporcionalidad", "lenguaje simbolico", "regularidades", "cartesiano",
        "cartesianos", "plano", "pares ordenados", "lineal", "lineales", "modelizacion"),
    3: ("geometria", "geometricas", "figura", "figuras", "triangulo", "triangulos",
        "cuadrilatero", "cuadrilateros", "angulo", "angulos", "paralelismo",
        "perpendicularidad", "circunferencia", "circunferencias", "circulos",
        "mediatrices", "bisectrices", "perimetro", "area", "poligonos",
        "lugar geometrico", "paralelogramo", "construccion", "medida"),
    4: ("estadistica", "estadisticos", "estadistico", "grafico", "graficos", "tabla",
        "tablas", "datos", "dato", "media", "moda", "probabilidad", "azar",
        "incertidumbre", "certeza", "variables cualitativas", "frecuencia",
        "encuesta", "valores estadisticos"),
}


def ejes_del_bloque(etiqueta: str) -> list[int]:
    t = normalizar_texto(etiqueta)
    return [e for e, claves in EJES_MATEMATICA.items() if any(k in t.split() for k in claves)]


def elegir_eje(texto: str, candidatos: list[int]) -> tuple[int, bool]:
    """Devuelve el eje y si la decisión fue clara (una pista gana sin empate)."""
    t = " " + normalizar_texto(texto) + " "
    puntos = {e: sum(t.count(" " + p + " ") for p in PISTAS[e]) for e in candidatos}
    orden = sorted(candidatos, key=lambda e: -puntos[e])
    if len(orden) == 1:
        return orden[0], True
    claro = puntos[orden[0]] > puntos[orden[1]]
    return orden[0], claro


def partir_contenidos(celda: str) -> list[str]:
    """La celda de contenidos es una lista escrita a mano. Se parte donde el
    equipo la separó: saltos de línea, barras con espacio y puntos seguidos.

    Lo que queda de menos de tres palabras se pega al anterior: así
    «Ángulos. Elementos. Clasificación.» queda en una sola opción y no en tres
    sueltas que el docente no reconocería. Es exactamente el problema que tenía
    la transcripción original de la Resolución.

    La barra sin espacios no parte: «Parámetros/medidas» es una sola cosa.
    """
    celda = (celda or "").replace("\xa0", " ")
    trozos: list[str] = []
    for linea in re.split(r"\n+", celda):
        for parte in re.split(r"\s+/\s*|\s*/\s+", linea):
            for frase in re.split(r"(?<=[a-záéíóúñ)])\.\s+(?=[A-ZÁÉÍÓÚÑ¿])", parte):
                frase = limpio(frase).strip(" ,;/-")
                frase = re.sub(r"\.$", "", frase).strip()
                if frase:
                    trozos.append(frase)

    # Un renglón que termina en «:» es un título de la lista, no un contenido
    trozos = [t for t in trozos if not t.endswith(":")]

    juntos: list[str] = []
    for t in trozos:
        if juntos and len(t.split()) < 3:
            juntos[-1] = f"{juntos[-1]}. {t}"
        else:
            juntos.append(t)

    vistos, finales = set(), []
    for t in juntos:
        clave = normalizar_texto(t)
        if clave and clave not in vistos:
            vistos.add(clave)
            finales.append(t[0].upper() + t[1:])
    return finales


VACIAS = {"de", "la", "el", "los", "las", "y", "o", "en", "a", "que", "del", "con", "por",
          "para", "su", "sus", "un", "una", "al", "se", "e", "entre"}


def palabras(t: str) -> set[str]:
    return {p for p in normalizar_texto(t).split() if p not in VACIAS and len(p) > 2}


def eje_de_la_resolucion(texto: str, anteriores: list[dict], candidatos: list[int]) -> tuple[int, float, str] | None:
    """Busca el saber de la Resolución que dice lo mismo y devuelve su eje.

    Muchos saberes priorizados son saberes de la Resolución, a veces con
    retoques. Cuando coinciden, el eje ya está decidido por el diseño y no hay
    que adivinarlo: es mejor fuente que cualquier palabra clave.
    """
    p = palabras(texto)
    if not p:
        return None
    mejor = None
    for s in anteriores:
        q = s["_palabras"]
        parecido = len(p & q) / len(p | q) if q else 0
        if mejor is None or parecido > mejor[1]:
            mejor = (s, parecido)
    if mejor and mejor[1] >= 0.5 and mejor[0]["_eje"] in candidatos:
        return mejor[0]["_eje"], mejor[1], mejor[0]["texto"]
    return None


def leer_grilla_trimestres(ruta: Path, anteriores: list[dict] | None = None) -> tuple[list[dict], list[str]]:
    """Bloques por trimestre; pares de columnas (saber, contenidos) por año."""
    anteriores = anteriores or []
    filas = leer_hoja(ruta)
    saberes: list[dict] = []
    notas: list[str] = []
    trimestre = None
    bloque: dict[int, list[int]] = {}
    pares = {1: (1, 2), 2: (3, 4), 3: (5, 6)}

    for n, f in enumerate(filas, 1):
        a = normalizar_texto(f[0])
        m = re.match(r"(primer|segundo|tercer) trimestre", a)
        if m:
            trimestre = TRIMESTRES[m.group(1)]

        # Fila de ejes del bloque: texto en B/D/F y nada en C/E/G
        etiquetas = {anio: limpio(f[s]) for anio, (s, c) in pares.items() if f[s].strip() and not f[c].strip()}
        if etiquetas and all(ejes_del_bloque(t) for t in etiquetas.values()):
            for anio, t in etiquetas.items():
                bloque[anio] = ejes_del_bloque(t)
            continue

        for anio, (cs, cc) in pares.items():
            saber, conts = limpio(f[cs]), f[cc]
            if not saber or set(saber) <= {"-"} or normalizar_texto(saber) in ("saberes", "contenidos"):
                continue
            if re.match(r"(primer|segundo|tercer) ano$|saberes priorizados", normalizar_texto(saber)):
                continue
            if trimestre is None or anio not in bloque:
                notas.append(f"Matemática fila {n}: saber sin trimestre o eje, se omitió: «{saber[:60]}»")
                continue
            coincide = eje_de_la_resolucion(saber, anteriores, bloque[anio])
            if coincide:
                eje, parecido, original = coincide
                claro, fuente = True, f"Resolución ({round(parecido * 100)} % igual)"
            else:
                eje, claro = elegir_eje(saber, bloque[anio])
                fuente = "palabras clave"
            saberes.append({"anio": anio, "trimestre": trimestre, "eje": eje, "texto": saber,
                            "contenidos": partir_contenidos(conts), "fila": n,
                            "eje_claro": claro, "candidatos": bloque[anio],
                            "eje_fuente": fuente, "celda_contenidos": limpio(conts)})
    return saberes, notas


# ----------------------------------------------- contenidos que vienen aparte

# La grilla de Lengua trae solo saberes. Los contenidos los armó el equipo en
# otro archivo, con una fila por contenido y el saber repetido en cada una.
CONTENIDOS_APARTE = {
    "lengua": "Lengua contenidos v3.xlsx",
}
AGREGADOS = AQUI / "contenidos_agregados.json"


def leer_contenidos_largos(ruta: Path) -> dict[tuple, list[str]]:
    """Archivo con una fila por contenido: columnas Año, Trimestre, Saber y
    Contenido. Devuelve los contenidos de cada saber, en el orden del archivo.

    Se cruza por texto del saber, año y trimestre, no por posición: así da
    igual si el archivo está ordenado distinto que la grilla.
    """
    filas = leer_hoja(ruta)
    cab = [normalizar_texto(c) for c in filas[0]]
    col = {k: cab.index(k) for k in ("ano", "trimestre", "saber", "contenido")}
    por_saber: dict[tuple, list[str]] = {}
    for f in filas[1:]:
        saber, cont = limpio(f[col["saber"]]), limpio(f[col["contenido"]])
        if not saber or not cont:
            continue
        clave = (normalizar_texto(saber), int(float(f[col["ano"]])), int(float(f[col["trimestre"]])))
        lista = por_saber.setdefault(clave, [])
        if normalizar_texto(cont) not in {normalizar_texto(c) for c in lista}:
            lista.append(re.sub(r"\.$", "", cont))
    return por_saber


def completar_contenidos(espacio: str, saberes: list[dict]) -> list[str]:
    """Llena los saberes que la grilla dejó sin contenidos. Lo de la grilla
    manda: esto solo toca los que llegaron vacíos."""
    notas = []
    if espacio in CONTENIDOS_APARTE:
        aparte = leer_contenidos_largos(buscar_fuente(CONTENIDOS_APARTE[espacio]))
        usados = 0
        for s in saberes:
            if not s["contenidos"]:
                encontrados = aparte.get((normalizar_texto(s["texto"]), s["anio"], s["trimestre"]))
                if encontrados:
                    s["contenidos"] = list(encontrados)
                    usados += 1
        sin = [s for s in saberes if not s["contenidos"]]
        notas.append(f"{espacio}: contenidos de «{CONTENIDOS_APARTE[espacio]}» para {usados} saberes"
                     + (f"; {len(sin)} siguen sin ninguno" if sin else ""))

    agregados = json.loads(AGREGADOS.read_text(encoding="utf-8")).get(espacio, {}) if AGREGADOS.exists() else {}
    por_texto = {normalizar_texto(k): v for k, v in agregados.items()}
    for s in saberes:
        if not s["contenidos"] and normalizar_texto(s["texto"]) in por_texto:
            s["contenidos"] = list(por_texto[normalizar_texto(s["texto"])])
            s["contenidos_agregados"] = True
            notas.append(f"{espacio} {s['anio']}° {ORDINAL[s['trimestre']]} trimestre: "
                         f"contenidos escritos aparte (la celda venía vacía) para «{s['texto'][:70]}»")
    return notas


# ------------------------------------------------------------------ materias

MATERIAS = {
    "lengua": ("Saberes priorizado.xlsx", leer_grilla_ejes),
    "matematica": ("PRIORIZACIÓN DE SABERES-CBS.xlsx", leer_grilla_trimestres),
}


def buscar_fuente(nombre: str) -> Path:
    for base in (AQUI, RAIZ / "datos"):
        if (base / nombre).exists():
            return base / nombre
    raise SystemExit(f"No encuentro «{nombre}» ni en datos/priorizados/ ni en datos/.")


def reemplazar(catalogo: dict, espacio: str, saberes: list[dict]) -> dict:
    """Saca los saberes y contenidos viejos de la materia y pone los nuevos.

    Los ejes no se tocan: son los de la Resolución y la grilla los nombra por
    número. Lo que cambia es qué saberes cuelgan de cada uno.
    """
    ejes = {e["orden"]: e for e in catalogo["ejes"] if e["espacio_id"] == espacio}
    ids_ejes = {e["id"] for e in ejes.values()}
    viejos = {s["id"] for s in catalogo["saberes"] if s["eje_id"] in ids_ejes}

    faltan = sorted({s["eje"] for s in saberes} - set(ejes))
    if faltan:
        raise SystemExit(f"{espacio}: la grilla usa ejes que el catálogo no tiene: {faltan}")

    catalogo["saberes"] = [s for s in catalogo["saberes"] if s["id"] not in viejos]
    catalogo["contenidos"] = [c for c in catalogo["contenidos"] if c["saber_id"] not in viejos]

    nuevos_saberes, nuevos_contenidos = [], []
    cuenta: dict[tuple, int] = {}
    orden_eje: dict[str, int] = {}
    for s in sorted(saberes, key=lambda x: (x["anio"], x["trimestre"], x["eje"], x["fila"])):
        eje = ejes[s["eje"]]
        clave = (eje["id"], s["anio"], s["trimestre"])
        cuenta[clave] = cuenta.get(clave, 0) + 1
        orden_eje[eje["id"]] = orden_eje.get(eje["id"], 0) + 1
        sid = f'{eje["id"]}--pr-a{s["anio"]}t{s["trimestre"]}s{cuenta[clave]}'
        s["id"] = sid
        nuevos_saberes.append({
            "id": sid, "eje_id": eje["id"], "anio": s["anio"], "trimestre": s["trimestre"],
            "texto": s["texto"], "calidad": "buena", "orden": orden_eje[eje["id"]],
        })
        for i, t in enumerate(s["contenidos"], 1):
            nuevos_contenidos.append({
                "id": f"{sid}--p{i}", "saber_id": sid, "texto": t,
                "texto_normalizado": normalizar_texto(t), "origen": ORIGEN_CONTENIDO,
            })

    catalogo["saberes"].extend(nuevos_saberes)
    catalogo["contenidos"].extend(nuevos_contenidos)
    return {"salen": len(viejos), "entran": len(nuevos_saberes), "contenidos": len(nuevos_contenidos)}


# ------------------------------------------------------------------ revisión

def escribir_revision(resultados: dict, notas: list[str], catalogo: dict) -> None:
    ejes = {e["id"]: e for e in catalogo["ejes"]}
    por_orden = {(e["espacio_id"], e["orden"]): e for e in catalogo["ejes"]}
    l = ["# Revisión de los saberes priorizados", "",
         "Generado por `datos/priorizados/convertir.py`. Es lo que va a ver el docente.",
         "Revisarlo antes de cargar: si algo está mal, se corrige en el Excel del equipo",
         "y se vuelve a correr el script.", ""]
    if notas:
        l += ["## Arreglos que hizo el script", ""] + [f"- {n}" for n in notas] + [""]

    dudosos = [(esp, s) for esp, (saberes, _) in resultados.items() for s in saberes
               if s.get("eje_fuente") == "palabras clave"]
    if dudosos:
        l += ["## Ejes que conviene confirmar", "",
              "La grilla de Matemática nombra dos ejes por bloque. Cuando el saber coincide",
              "con uno de la Resolución, se tomó su eje. Estos no coinciden con ninguno, así",
              "que el eje lo eligió el script por las palabras del saber. ⚠ = sin pista clara.", ""]
        for esp, s in dudosos:
            otros = " / ".join(por_orden[(esp, c)]["nombre"] for c in s["candidatos"])
            aviso = "" if s.get("eje_claro") else " ⚠"
            l.append(f"- {s['anio']}° año, {ORDINAL[s['trimestre']]} trimestre (fila {s['fila']}){aviso}: "
                     f"«{s['texto'][:90]}» → **{por_orden[(esp, s['eje'])]['nombre']}** "
                     f"(podía ser: {otros})")
        l.append("")

    for esp, (saberes, _) in resultados.items():
        nombre = next(e["nombre"] for e in catalogo["espacios"] if e["id"] == esp)
        con = sum(len(s["contenidos"]) for s in saberes)
        sin = sum(1 for s in saberes if not s["contenidos"])
        l += [f"## {nombre}", "",
              f"{len(saberes)} saberes, {con} contenidos sugeridos"
              + (f", **{sin} saberes sin ningún contenido**" if sin else "") + ".", ""]
        for anio in (1, 2, 3):
            for tri in (1, 2, 3):
                grupo = [s for s in saberes if s["anio"] == anio and s["trimestre"] == tri]
                if not grupo:
                    continue
                l += [f"### {anio}° año · {ORDINAL[tri]} trimestre ({len(grupo)})", ""]
                for s in grupo:
                    eje = por_orden[(esp, s["eje"])]["nombre"]
                    marca = {"palabras clave": " — eje elegido por el script, confirmar"}.get(s.get("eje_fuente"), "")
                    l.append(f"- **{s['texto']}**  \n  _{eje}{marca}_")
                    for c in s["contenidos"]:
                        l.append(f"  - {c}")
                l.append("")
    REVISION.write_text("\n".join(l) + "\n", encoding="utf-8", newline="\n")


def main() -> None:
    revisar = "--revisar" in sys.argv
    catalogo = json.loads(CATALOGO.read_text(encoding="utf-8"))
    resultados, notas = {}, []

    for espacio, (archivo, lector) in MATERIAS.items():
        ejes = {e["id"]: e["orden"] for e in catalogo["ejes"] if e["espacio_id"] == espacio}
        anteriores = [dict(s, _eje=ejes[s["eje_id"]], _palabras=palabras(s["texto"]))
                      for s in catalogo["saberes"] if s["eje_id"] in ejes]
        saberes, n = lector(buscar_fuente(archivo), anteriores)
        n += completar_contenidos(espacio, saberes)
        resultados[espacio] = (saberes, archivo)
        notas += n

    print("Saberes priorizados")
    for espacio, (saberes, archivo) in resultados.items():
        con = sum(len(s["contenidos"]) for s in saberes)
        sin = sum(1 for s in saberes if not s["contenidos"])
        dudosos = sum(1 for s in saberes if s.get("eje_fuente") == "palabras clave")
        de_la_672 = sum(1 for s in saberes if str(s.get("eje_fuente", "")).startswith("Resolución"))
        por = {}
        for s in saberes:
            por[s["anio"]] = por.get(s["anio"], 0) + 1
        print(f"  {espacio:<11} {len(saberes):>3} saberes {por}  {con} contenidos"
              + (f"  · {sin} sin contenidos" if sin else "")
              + (f"  · eje de la Resolución en {de_la_672}, a confirmar {dudosos}" if "eje_fuente" in (saberes[0] if saberes else {}) else ""))
    for n in notas:
        print("  nota:", n)

    for espacio, (saberes, _) in resultados.items():
        r = reemplazar(catalogo, espacio, saberes)
        print(f"  {espacio:<11} salen {r['salen']} saberes, entran {r['entran']} con {r['contenidos']} contenidos")

    escribir_revision(resultados, notas, catalogo)
    print(f"  escrito {REVISION.relative_to(RAIZ)}")

    if revisar:
        print("(--revisar: catalogo.json no se tocó)")
        return
    CATALOGO.write_text(json.dumps(catalogo, ensure_ascii=False, indent=1) + "\n",
                        encoding="utf-8", newline="\n")
    print(f"  escrito {CATALOGO.relative_to(RAIZ)}")


if __name__ == "__main__":
    main()
