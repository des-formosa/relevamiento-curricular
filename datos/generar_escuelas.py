#!/usr/bin/env python3
"""Genera datos/escuelas.json desde la nómina oficial en Excel.

    python datos/generar_escuelas.py            escribe el JSON
    python datos/generar_escuelas.py --revisar  informa sin escribir

La fuente es «Nomina de Escuelas por Departamentos.xlsx», Hoja1, que trae las
288 unidades educativas de nivel secundario de la provincia: 113 E.P.E.S. y
175 anexos (rurales, de Educación Intercultural Bilingüe y agrarios).

Por qué se lee el Excel y no se edita el JSON a mano: la nómina la mantiene el
Ministerio y se actualiza. Regenerar es reemplazar el .xlsx y correr esto.

No hay openpyxl y no vale sumar dependencias, así que el .xlsx se abre como lo
que es: un zip con XML adentro.
"""
from __future__ import annotations

import json
import re
import sys
import unicodedata
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

RAIZ = Path(__file__).resolve().parent.parent
FUENTE = RAIZ / "datos" / "Nomina de Escuelas por Departamentos.xlsx"
SALIDA = RAIZ / "datos" / "escuelas.json"

NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"

# El id del departamento es estable: ya está en los aportes cargados.
DEPARTAMENTOS = [
    ("formosa", "Formosa", "FORMOSA"),
    ("pilcomayo", "Pilcomayo", "PILCOMAYO"),
    ("pirane", "Pirané", "PIRANE"),
    ("patino", "Patiño", "PATIÑO"),
    ("bermejo", "Bermejo", "BERMEJO"),
    ("matacos", "Matacos", "MATACOS"),
    ("ramon-lista", "Ramón Lista", "RAMON LISTA"),
    ("pilagas", "Pilagás", "PILAGAS"),
    ("laishi", "Laishí", "MISION LAISHI"),
]
POR_NOMBRE_EXCEL = {excel: ident for ident, _, excel in DEPARTAMENTOS}

# Columnas de Hoja1
ORDEN, ZONAL, CUE, NOMBRE, LOCALIDAD_ALT, LOCALIDAD, DEPARTAMENTO, REFERENCIA = range(8)


# ---------------------------------------------------------------- leer el xlsx

def _columna(ref: str) -> int:
    n = 0
    for c in re.match(r"([A-Z]+)", ref).group(1):
        n = n * 26 + (ord(c) - 64)
    return n - 1


def leer_hoja(ruta: Path, hoja: int = 0) -> list[list[str]]:
    z = zipfile.ZipFile(ruta)
    textos: list[str] = []
    if "xl/sharedStrings.xml" in z.namelist():
        for si in ET.fromstring(z.read("xl/sharedStrings.xml")).findall(NS + "si"):
            textos.append("".join(t.text or "" for t in si.iter(NS + "t")))

    archivos = sorted(n for n in z.namelist() if re.match(r"xl/worksheets/sheet\d+\.xml$", n))
    raiz = ET.fromstring(z.read(archivos[hoja]))
    filas = []
    for fila in raiz.iter(NS + "row"):
        celdas: dict[int, str] = {}
        for c in fila.findall(NS + "c"):
            v = c.find(NS + "v")
            if c.get("t") == "s" and v is not None:
                valor = textos[int(v.text)]
            elif c.get("t") == "inlineStr":
                valor = "".join(t.text or "" for t in c.iter(NS + "t"))
            else:
                valor = v.text if v is not None else ""
            celdas[_columna(c.get("r"))] = (valor or "").strip()
        if celdas:
            filas.append([celdas.get(i, "") for i in range(max(celdas) + 1)])
    return filas


# ------------------------------------------------------------------- normalizar

def normalizar_texto(t: str) -> str:
    """Espejo exacto de normalizarTexto() en assets/normalizar.js."""
    t = unicodedata.normalize("NFD", (t or "").lower())
    t = "".join(c for c in t if unicodedata.category(c) != "Mn")
    return re.sub(r"[^a-z0-9]+", " ", t).strip()


def limpiar(t: str) -> str:
    """Saca el «12. » del orden y los espacios duros con los que viene el Excel."""
    t = t.replace("\xa0", " ")
    t = re.sub(r"^\s*\d+\.\s*", "", t)
    return re.sub(r"\s+", " ", t).strip()


def nombre_oficial(t: str) -> str:
    """Unifica «Nº» y «N°», que en el Excel aparecen mezclados."""
    return re.sub(r"N[ºo°]\s*", "N° ", t).strip()


def para_mostrar(t: str) -> str:
    """Cómo lo lee el docente: la sigla desplegada, como en toda la provincia.

    El Excel abrevia «EPES Nº 41»; en la escuela el cartel dice «E.P.E.S.».
    La forma corta del Excel igual entra en el índice de búsqueda.
    """
    t = re.sub(r"\bEPEP\b", "E.P.E.P.", t)
    t = re.sub(r"\bEPES\s*-?\s*EIB\b", "E.P.E.S. E.I.B.", t)
    t = re.sub(r"\bEPES AGRARIA\b", "E.P.E.S. Agraria", t)
    t = re.sub(r"\bEPES\b", "E.P.E.S.", t)
    t = re.sub(r"\bEIB\b", "E.I.B.", t)
    t = re.sub(r"\bANEXO\b", "Anexo", t)
    return re.sub(r"\s+", " ", t).strip()


def slug(t: str) -> str:
    return re.sub(r"\s+", "-", normalizar_texto(t))


# ------------------------------------------------------------------ construir

def localidad_de(f: list[str]) -> str:
    return limpiar(f[LOCALIDAD]) or limpiar(f[LOCALIDAD_ALT])


def construir() -> tuple[dict, list[str]]:
    filas = leer_hoja(FUENTE)[1:]
    avisos: list[str] = []
    escuelas = []
    vistos: dict[str, int] = {}

    # Primero se cuenta cuántas veces aparece cada nombre. «San Isidro» está
    # tres veces: si el desempate dependiera de cuál se procesa primero, un
    # reordenamiento de la planilla intercambiaría dos escuelas y con ellas los
    # aportes que ya tengan cargados. Con el conteo hecho de antemano, todas
    # las repetidas llevan el CUE y el id no depende del orden.
    repetidos: dict[str, int] = {}
    for f in filas:
        n = nombre_oficial(limpiar((f + [""] * 8)[NOMBRE]))
        if n:
            repetidos[n] = repetidos.get(n, 0) + 1

    for f in filas:
        f = f + [""] * (8 - len(f))
        nombre = nombre_oficial(limpiar(f[NOMBRE]))
        if not nombre:
            continue

        depto_excel = f[DEPARTAMENTO].strip()
        depto = POR_NOMBRE_EXCEL.get(depto_excel)
        if depto is None:
            avisos.append(f"departamento desconocido: {depto_excel!r} en «{nombre}»")
            continue

        # El id se arma del nombre, no del CUE: hay cinco CUE repetidos en la
        # planilla y un id duplicado dejaría escuelas pisándose.
        #
        # Los patrones de E.P.E.S. valen solo para la escuela cabecera. Sus
        # anexos llevan «ANEXO» en el nombre («EPES AGRARIA N° 2 - ANEXO 3 -
        # EPEP N° 226») y van por el camino genérico: si se les aplicara el
        # patrón del número, los nueve anexos de la Agraria N° 2 terminarían
        # todos con el mismo id.
        cabecera = "ANEXO" not in nombre.upper()
        m = re.match(r"^EPES N° (\d+)$", nombre) if cabecera else None
        m_eib = re.match(r"^EPES EIB N° (\d+)$", nombre) if cabecera else None
        m_agr = re.match(r"^EPES AGRARIA N° (\d+)\b", nombre) if cabecera else None
        if m:
            ident, numero = f"epes-{m.group(1)}", m.group(1)
        elif m_eib:
            ident, numero = f"epes-eib-{m_eib.group(1)}", m_eib.group(1)
        elif m_agr:
            ident, numero = f"epes-agraria-{m_agr.group(1)}", m_agr.group(1)
        else:
            base = re.sub(r"^anexo-de-educacion-(rural|intercultural-bilingue)-", "anexo-", slug(nombre))
            ident, numero = base, ""

        # Nombre repetido en la nómina: todas sus apariciones llevan el CUE
        if repetidos.get(nombre, 0) > 1:
            ident = f"{ident}-{f[CUE]}"
        if ident in vistos:
            avisos.append(f"id repetido incluso con CUE: {ident} ({nombre}, {localidad_de(f)})")
            continue
        vistos[ident] = 1

        localidad = localidad_de(f)
        nombre_depto = next(n for i, n, _ in DEPARTAMENTOS if i == depto)

        # El docente escribe «epes 41» o «e.p.e.s. 41»: las dos formas entran
        # en el índice. El CUE NO: son nueve dígitos, y con él adentro buscar
        # «41» devolvía cualquier escuela que lo tuviera en el medio del CUE.
        mostrar = para_mostrar(nombre)
        busqueda = normalizar_texto(f"{mostrar} {nombre} {localidad} {nombre_depto}")

        escuelas.append({
            "id": ident,
            "numero": numero,
            "denominacion": "",
            "nombre": mostrar,
            "localidad": localidad,
            "departamento_id": depto,
            "tipo": f[REFERENCIA].strip() or "EPES",
            "cue": f[CUE],
            "orden": int(f[ORDEN]) if f[ORDEN].isdigit() else 9999,
            "busqueda": busqueda,
        })

    return {
        "fuente": FUENTE.name,
        "departamentos": [{"id": i, "nombre": n} for i, n, _ in DEPARTAMENTOS],
        "escuelas": escuelas,
    }, avisos


def main() -> None:
    revisar = "--revisar" in sys.argv
    datos, avisos = construir()
    escuelas = datos["escuelas"]

    por_tipo: dict[str, int] = {}
    por_depto: dict[str, int] = {}
    for e in escuelas:
        por_tipo[e["tipo"]] = por_tipo.get(e["tipo"], 0) + 1
        por_depto[e["departamento_id"]] = por_depto.get(e["departamento_id"], 0) + 1

    print(f"{len(escuelas)} escuelas en {len(datos['departamentos'])} departamentos")
    print("  por tipo:  " + ", ".join(f"{k} {v}" for k, v in sorted(por_tipo.items())))
    print("  por depto: " + ", ".join(f"{k} {v}" for k, v in sorted(por_depto.items())))
    for a in avisos:
        print("  aviso:", a)

    if SALIDA.exists():
        antes = json.loads(SALIDA.read_text(encoding="utf-8"))["escuelas"]
        ids_antes = {e["id"] for e in antes}
        ids_ahora = {e["id"] for e in escuelas}
        fuera = sorted(ids_antes - ids_ahora)
        if fuera:
            print(f"  salen de la nómina ({len(fuera)}): " + ", ".join(fuera))
        print(f"  entran: {len(ids_ahora - ids_antes)}")

    if revisar:
        print("(--revisar: no se escribió nada)")
        return

    SALIDA.write_text(json.dumps(datos, ensure_ascii=False, indent=1) + "\n",
                      encoding="utf-8", newline="\n")
    print(f"escrito {SALIDA.relative_to(RAIZ)}")


if __name__ == "__main__":
    main()
