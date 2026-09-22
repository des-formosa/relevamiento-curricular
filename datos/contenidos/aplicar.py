"""
Aplica los contenidos sugeridos propuestos por el equipo a datos/catalogo.json.

Por qué existe: la transcripción del PDF dejó, en muchos saberes, "contenidos"
que eran recortes literales del propio texto del saber, a veces cortados a la
mitad ("Mcd en situaciones planteadas", "Noción energía"). Un docente no
reconoce eso como un contenido que enseña: no lo elige, escribe texto libre y
se pierde la comparabilidad, que es el objetivo del relevamiento.

Cada archivo datos/contenidos/<espacio_id>.json mapea saber_id → lista de
contenidos escritos con criterio de la materia. Este script los vuelca al
catálogo:

  · los contenidos de un saber cubierto se reemplazan por completo;
  · los nuevos llevan id  <saber_id>--p<n>  y  origen: "propuesto_equipo",
    para distinguirlos de los que están textualmente en la Resolución 672;
  · los contenidos originales se guardan una sola vez en
    datos/contenidos_672_originales.json, para que el equipo pueda revisarlos.

Uso (desde la raíz del repositorio):
    python datos/contenidos/aplicar.py            # aplica y reescribe el catálogo
    python datos/contenidos/aplicar.py --revisar  # solo informa, no escribe
"""

import json
import re
import sys
import unicodedata
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent.parent
CATALOGO = RAIZ / "datos" / "catalogo.json"
CARPETA = RAIZ / "datos" / "contenidos"
RESPALDO = RAIZ / "datos" / "contenidos_672_originales.json"


def normalizar_texto(t: str) -> str:
    """Espejo exacto de normalizarTexto() en assets/normalizar.js."""
    t = unicodedata.normalize("NFD", (t or "").lower())
    t = "".join(ch for ch in t if unicodedata.category(ch) != "Mn")
    return re.sub(r"[^a-z0-9]+", " ", t).strip()


def main() -> None:
    revisar = "--revisar" in sys.argv
    catalogo = json.loads(CATALOGO.read_text(encoding="utf-8"))
    espacio_de_eje = {e["id"]: e["espacio_id"] for e in catalogo["ejes"]}
    saberes_por_espacio = {}
    for s in catalogo["saberes"]:
        saberes_por_espacio.setdefault(espacio_de_eje[s["eje_id"]], []).append(s["id"])
    ids_validos = {s["id"] for s in catalogo["saberes"]}

    propuestos = {}
    problemas = []
    for archivo in sorted(CARPETA.glob("*.json")):
        datos = json.loads(archivo.read_text(encoding="utf-8"))
        for saber_id, textos in datos.items():
            if saber_id not in ids_validos:
                problemas.append(f"{archivo.name}: el saber {saber_id} no existe en el catálogo")
                continue
            limpios, vistos = [], set()
            for texto in textos:
                texto = re.sub(r"\s+", " ", (texto or "").strip())
                clave = normalizar_texto(texto)
                if not clave or clave in vistos:
                    continue
                vistos.add(clave)
                limpios.append(texto)
            if len(limpios) < 3:
                problemas.append(f"{archivo.name}: {saber_id} tiene solo {len(limpios)} contenidos")
            propuestos[saber_id] = limpios

    if problemas:
        print("Avisos:")
        for p in problemas:
            print("  ·", p)

    # Cobertura por espacio curricular
    print(f"\n{'Espacio':46} {'saberes':>8} {'cubiertos':>10} {'contenidos':>11}")
    total_cubiertos = total_saberes = 0
    for espacio in catalogo["espacios"]:
        ids = saberes_por_espacio.get(espacio["id"], [])
        cubiertos = [i for i in ids if i in propuestos]
        contenidos = sum(len(propuestos[i]) for i in cubiertos)
        total_cubiertos += len(cubiertos)
        total_saberes += len(ids)
        marca = "" if len(cubiertos) == len(ids) else "  ← falta"
        print(f"{espacio['nombre'][:46]:46} {len(ids):8} {len(cubiertos):10} {contenidos:11}{marca}")
    print(f"{'TOTAL':46} {total_saberes:8} {total_cubiertos:10}")

    if revisar:
        return

    if not RESPALDO.exists():
        RESPALDO.write_text(
            json.dumps({"contenidos": catalogo["contenidos"]}, ensure_ascii=False, indent=1),
            encoding="utf-8", newline="\n")
        print(f"\nGuardé los {len(catalogo['contenidos'])} contenidos originales en {RESPALDO.name}")

    nuevos = []
    for contenido in catalogo["contenidos"]:
        if contenido["saber_id"] not in propuestos:
            nuevos.append(contenido)          # saber sin propuesta: queda como estaba
    for saber_id, textos in propuestos.items():
        for n, texto in enumerate(textos, start=1):
            nuevos.append({
                "id": f"{saber_id}--p{n}",
                "saber_id": saber_id,
                "texto": texto,
                "texto_normalizado": normalizar_texto(texto),
                "origen": "propuesto_equipo",
            })

    orden = {s["id"]: n for n, s in enumerate(catalogo["saberes"])}
    nuevos.sort(key=lambda c: (orden[c["saber_id"]], c["id"]))
    catalogo["contenidos"] = nuevos
    CATALOGO.write_text(json.dumps(catalogo, ensure_ascii=False, indent=1), encoding="utf-8", newline="\n")
    print(f"\ncatalogo.json actualizado: {len(nuevos)} contenidos "
          f"({sum(1 for c in nuevos if c['origen'] == 'propuesto_equipo')} propuestos por el equipo)")


if __name__ == "__main__":
    main()
