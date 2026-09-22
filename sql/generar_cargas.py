"""
Genera los archivos de carga a partir de los JSON del repositorio:

    datos/escuelas.json  →  sql/06_cargar_escuelas.sql
    datos/catalogo.json  →  sql/07_cargar_catalogo.sql

Cada archivo es una sola llamada a cargar_escuelas() / cargar_catalogo()
(ver 03_funciones.sql), que agrega y actualiza por id. Se pueden correr
todas las veces que haga falta: cuando llegan las correcciones del equipo,
se actualiza el JSON, se vuelve a correr este script y se pega el .sql en el
SQL Editor de Supabase.

Uso (desde la raíz del repositorio):
    python sql/generar_cargas.py
"""

import json
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
SQL = RAIZ / "sql"
ETIQUETA = "$datos$"


def a_sql(funcion: str, datos: dict, origen: str) -> str:
    texto = json.dumps(datos, ensure_ascii=False, separators=(",", ":"))
    if ETIQUETA in texto:
        raise SystemExit(f"El JSON contiene {ETIQUETA}: cambiá la etiqueta en generar_cargas.py")
    return (
        f"-- Generado por sql/generar_cargas.py a partir de {origen}. No editar a mano.\n"
        f"-- Pegar completo en el SQL Editor de Supabase y ejecutar.\n"
        f"select public.{funcion}({ETIQUETA}{texto}{ETIQUETA}::jsonb);\n"
    )


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
        "contenidos": [
            {k: c.get(k) for k in ("id", "saber_id", "texto", "origen")} for c in catalogo["contenidos"]
        ],
    }

    (SQL / "06_cargar_escuelas.sql").write_text(
        a_sql("cargar_escuelas", escuelas_min, "datos/escuelas.json"), encoding="utf-8", newline="\n")
    (SQL / "07_cargar_catalogo.sql").write_text(
        a_sql("cargar_catalogo", catalogo_min, "datos/catalogo.json"), encoding="utf-8", newline="\n")

    print(f"06_cargar_escuelas.sql  {len(escuelas_min['escuelas'])} escuelas, "
          f"{len(escuelas_min['departamentos'])} departamentos")
    print(f"07_cargar_catalogo.sql  {len(catalogo_min['saberes'])} saberes, "
          f"{len(catalogo_min['contenidos'])} contenidos")


if __name__ == "__main__":
    main()
