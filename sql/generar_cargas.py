"""
Genera los archivos de carga a partir de los JSON del repositorio:

    datos/escuelas.json  →  sql/06_cargar_escuelas.sql
    datos/catalogo.json  →  sql/07_cargar_catalogo.sql       (catálogo sin contenidos)
                            sql/08_cargar_contenidos_N.sql   (contenidos, en lotes)

Por qué los contenidos van aparte y en lotes: el SQL Editor de Supabase rechaza
las consultas muy grandes ("Query is too large to be run via the SQL Editor") y
los 4.716 contenidos pesan cerca de un mega. Cada lote trae saberes enteros con
todos sus contenidos, así que se pueden correr en cualquier orden y repetir los
que haga falta.

Todos los archivos se pueden ejecutar más de una vez: agregan, actualizan y
borran por id. Cuando llegan correcciones, se actualiza el JSON, se vuelve a
correr este script y se pegan los .sql en el SQL Editor.

Uso (desde la raíz del repositorio):
    python sql/generar_cargas.py
"""

import json
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
SQL = RAIZ / "sql"
ETIQUETA = "$datos$"
# El SQL Editor corta cerca del mega; se deja margen para el resto de la consulta.
TOPE_LOTE = 400_000


def a_sql(funcion: str, datos: dict, origen: str) -> str:
    texto = json.dumps(datos, ensure_ascii=False, separators=(",", ":"))
    if ETIQUETA in texto:
        raise SystemExit(f"El JSON contiene {ETIQUETA}: cambiá la etiqueta en generar_cargas.py")
    return (
        f"-- Generado por sql/generar_cargas.py a partir de {origen}. No editar a mano.\n"
        f"-- Pegar completo en el SQL Editor de Supabase y ejecutar.\n"
        f"select public.{funcion}({ETIQUETA}{texto}{ETIQUETA}::jsonb);\n"
    )


def escribir(nombre: str, contenido: str) -> Path:
    ruta = SQL / nombre
    ruta.write_text(contenido, encoding="utf-8", newline="\n")
    return ruta


def main() -> None:
    escuelas = json.loads((RAIZ / "datos" / "escuelas.json").read_text(encoding="utf-8"))
    escuelas_min = {
        "departamentos": [{"id": d["id"], "nombre": d["nombre"]} for d in escuelas["departamentos"]],
        "escuelas": [
            {k: e.get(k) for k in ("id", "departamento_id", "numero", "denominacion", "nombre", "localidad")}
            for e in escuelas["escuelas"]
        ],
    }

    catalogo = json.loads((RAIZ / "datos" / "catalogo.json").read_text(encoding="utf-8"))
    catalogo_min = {
        "areas": [{k: a[k] for k in ("id", "nombre", "orden")} for a in catalogo["areas"]],
        "espacios": [
            {k: e.get(k) for k in ("id", "area_id", "nombre", "anios_dictados", "saberes_por_ciclo", "origen", "orden")}
            for e in catalogo["espacios"]
        ],
        "ejes": [{k: e[k] for k in ("id", "espacio_id", "nombre", "orden")} for e in catalogo["ejes"]],
        "saberes": [
            {k: s.get(k) for k in ("id", "eje_id", "anio", "trimestre", "texto", "calidad", "orden")}
            for s in catalogo["saberes"]
        ],
        # texto_normalizado se recalcula en la base con normalizar_texto()
        "contenidos": [],   # los contenidos van en sus propios archivos, ver abajo
    }
    contenidos = [
        {k: c.get(k) for k in ("id", "saber_id", "texto", "origen")} for c in catalogo["contenidos"]
    ]

    escribir("06_cargar_escuelas.sql", a_sql("cargar_escuelas", escuelas_min, "datos/escuelas.json"))
    escribir("07_cargar_catalogo.sql", a_sql("cargar_catalogo", catalogo_min, "datos/catalogo.json"))

    # Lotes de contenidos, sin partir nunca un saber entre dos archivos
    for viejo in SQL.glob("08_cargar_contenidos_*.sql"):
        viejo.unlink()

    por_saber: dict = {}
    for c in contenidos:
        por_saber.setdefault(c["saber_id"], []).append(c)

    lotes, actual, peso = [], [], 0
    for grupo in por_saber.values():
        tamanio = len(json.dumps(grupo, ensure_ascii=False))
        if actual and peso + tamanio > TOPE_LOTE:
            lotes.append(actual)
            actual, peso = [], 0
        actual.extend(grupo)
        peso += tamanio
    if actual:
        lotes.append(actual)

    for n, lote in enumerate(lotes, start=1):
        escribir(
            f"08_cargar_contenidos_{n}.sql",
            a_sql("cargar_contenidos", {"contenidos": lote}, f"datos/catalogo.json (lote {n} de {len(lotes)})"),
        )

    print(f"06_cargar_escuelas.sql  {len(escuelas_min['escuelas'])} escuelas, "
          f"{len(escuelas_min['departamentos'])} departamentos")
    print(f"07_cargar_catalogo.sql  {len(catalogo_min['saberes'])} saberes, "
          f"{len(catalogo_min['ejes'])} ejes (sin contenidos)")
    for n, lote in enumerate(lotes, start=1):
        kb = (SQL / f"08_cargar_contenidos_{n}.sql").stat().st_size // 1024
        print(f"08_cargar_contenidos_{n}.sql  {len(lote)} contenidos, {kb} KB")


if __name__ == "__main__":
    main()
