"""
Planillas de directivos → SQL que carga contactos_escuela.

Las planillas traen nombre y celular de cada director: son datos personales y
el repositorio es público. Por eso ni las planillas ni el SQL que sale de acá
se versionan (ver .gitignore): el SQL se corre una vez en el SQL Editor de
Supabase, donde la tabla solo la lee el equipo (sql/13_contactos_escuelas.sql).

Uso:
    python datos/generar_contactos.py DIRECTIVOS_INTERIOR.xlsx DIRECTIVOS_CAPITAL.xlsx
    python datos/generar_contactos.py ... --revisar        informa sin escribir
    python datos/generar_contactos.py ... --salida ruta.sql

Por defecto escribe sql/privado/14_cargar_contactos.sql.

Cómo se reconoce cada escuela:
  - «EPES Nº 12», «EPES N° 1 EIB», «EPES EIB Nº 2» → epes-12, epes-eib-1, epes-eib-2.
  - Un anexo («AER El Totoral», o «AER» con la localidad al lado) se busca por
    nombre o localidad entre los anexos de la nómina; si hay más de uno que
    coincide, no se adivina: queda en el informe.
"""
import argparse
import json
import re
import sys
import unicodedata
from pathlib import Path

import openpyxl

RAIZ = Path(__file__).resolve().parent.parent
SALIDA = RAIZ / 'sql' / 'privado' / '14_cargar_contactos.sql'


def normalizar(t):
    t = unicodedata.normalize('NFD', str(t or '').lower())
    t = ''.join(c for c in t if unicodedata.category(c) != 'Mn')
    return re.sub(r'\s+', ' ', re.sub(r'[^a-z0-9]+', ' ', t)).strip()


def capitalizar(nombre):
    """«PÉREZ ANA MARÍA» → «Pérez Ana María». Si ya viene en minúsculas, igual."""
    partes = []
    for p in str(nombre).split():
        partes.append('-'.join(x[:1].upper() + x[1:].lower() for x in p.split('-')))
    return ' '.join(partes)


def digitos(t):
    return re.sub(r'\D', '', str(t or ''))


def leer_filas(ruta):
    """Una fila por escuela, venga de la planilla del interior o de la de capital."""
    libro = openpyxl.load_workbook(ruta, read_only=True, data_only=True)
    filas = []
    for hoja in libro.worksheets:
        cabecera = None
        for fila in hoja.iter_rows(values_only=True):
            celdas = [c if c is None else str(c).strip() for c in fila]
            if not any(celdas):
                continue
            textos = [normalizar(c) for c in celdas]
            if cabecera is None:
                if any(t.startswith('director') for t in textos):
                    cabecera = textos
                continue
            def col(*claves):
                for i, t in enumerate(cabecera):
                    if any(t.startswith(k) for k in claves) and i < len(celdas):
                        return celdas[i]
                return None
            filas.append({
                'hoja': hoja.title,
                'escuela': col('epes', 'escuelas'),
                'nombre_escuela': col('nombre'),
                'localidad': col('localidad', 'ubic'),
                'director': col('director'),
                'situacion': col('sit'),
                'celular': col('telefono', 'celular'),
            })
        if cabecera:
            break   # la primera hoja con cabecera es la buena; las demás son copias
    return filas


def indice_escuelas():
    datos = json.loads((RAIZ / 'datos' / 'escuelas.json').read_text(encoding='utf-8'))
    return {e['id']: e for e in datos['escuelas']}


def id_epes(texto):
    t = normalizar(texto)
    m = re.match(r'^epes (?:n )?(?:(eib|agraria) )?(?:n )?(\d+)(?: (eib|agraria))?$', t)
    if not m:
        return None
    tipo = m.group(1) or m.group(3)
    return f"epes-{tipo}-{m.group(2)}" if tipo else f"epes-{m.group(2)}"


def buscar_anexo(fila, escuelas):
    """Un anexo por su nombre («AER El Totoral») o su localidad; solo si es uno."""
    pistas = []
    for t in (fila['nombre_escuela'], fila['escuela']):
        t = normalizar(re.sub(r'(?i)\bAER\b( EIB)?', '', t or ''))
        if t:
            pistas.append(t)
    if fila['localidad']:
        pistas.append(normalizar(fila['localidad']))
    for pista in pistas:
        candidatos = [e for e in escuelas.values() if e['tipo'].startswith('ANEXO')
                      and (normalizar(e['localidad']) == pista or normalizar(e['nombre']).endswith(' ' + pista))]
        if len(candidatos) == 1:
            return candidatos[0]['id']
    return None


def sql_texto(v):
    return 'null' if v in (None, '') else "'" + str(v).replace("'", "''") + "'"


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('planillas', nargs='+')
    p.add_argument('--revisar', action='store_true')
    p.add_argument('--salida', default=str(SALIDA))
    a = p.parse_args()

    escuelas = indice_escuelas()
    contactos, sin_escuela, sin_datos = [], [], 0
    for ruta in a.planillas:
        for f in leer_filas(ruta):
            if not f['director'] and not digitos(f['celular']):
                sin_datos += 1     # filas de anexos sin director propio
                continue
            escuela_id = id_epes(f['escuela']) if f['escuela'] else None
            if not escuela_id or escuela_id not in escuelas:
                escuela_id = buscar_anexo(f, escuelas)
            if not escuela_id:
                sin_escuela.append(f"{Path(ruta).name}: «{f['escuela'] or ''} {f['nombre_escuela'] or ''}» ({f['localidad'] or 'sin localidad'})")
                continue
            celular = digitos(f['celular'])
            situacion = normalizar(f['situacion']) or None
            contactos.append({
                'escuela_id': escuela_id,
                'nombre': capitalizar(f['director']) if f['director'] else None,
                'cargo': 'Dirección' + (f' · {situacion}' if situacion else ''),
                'celular': celular if len(celular) >= 6 else None,
            })

    repetidas = sorted({c['escuela_id'] for c in contactos if sum(x['escuela_id'] == c['escuela_id'] for x in contactos) > 1})
    print(f"{len(contactos)} contactos para {len({c['escuela_id'] for c in contactos})} escuelas"
          f" ({sum(1 for c in contactos if c['celular'])} con celular).")
    print(f"{sin_datos} filas sin director ni celular (anexos que dependen de su sede): no se cargan.")
    if repetidas:
        print('Escuelas con más de un contacto: ' + ', '.join(repetidas))
    if sin_escuela:
        print(f"{len(sin_escuela)} filas que no se pudieron ubicar en la nómina:")
        for s in sin_escuela:
            print('  - ' + s)
    if a.revisar:
        return

    valores = ',\n'.join(
        f"  ({sql_texto(c['escuela_id'])}, {sql_texto(c['nombre'])}, {sql_texto(c['cargo'])}, {sql_texto(c['celular'])})"
        for c in contactos)
    sql = f"""-- GENERADO por datos/generar_contactos.py — NO VERSIONAR: trae datos personales.
-- Carga los contactos de las planillas de directivos. Se puede volver a correr:
-- reemplaza lo que vino de una planilla, salvo en las escuelas donde el equipo
-- ya agregó o corrigió un contacto desde el panel: ahí manda lo del equipo, y
-- si no se salteara, el dato viejo volvería al lado del corregido. Los correos
-- oficiales (datos/generar_correos.py) no cuentan: van aparte.
begin;
delete from public.contactos_escuela c
 where c.origen = 'planilla_directivos'
   and not exists (select 1 from public.contactos_escuela p where p.escuela_id = c.escuela_id and p.origen = 'panel');
insert into public.contactos_escuela (escuela_id, nombre, cargo, celular, origen)
select v.escuela_id, v.nombre, v.cargo, v.celular, 'planilla_directivos'
  from (values
{valores}
  ) as v (escuela_id, nombre, cargo, celular)
  join public.escuelas e on e.id = v.escuela_id
 where not exists (select 1 from public.contactos_escuela p
                    where p.escuela_id = v.escuela_id and p.origen <> 'correos_oficiales');
commit;
select count(*) as contactos_cargados from public.contactos_escuela where origen = 'planilla_directivos';
"""
    salida = Path(a.salida)
    salida.parent.mkdir(parents=True, exist_ok=True)
    salida.write_text(sql, encoding='utf-8')
    print(f"Escrito {salida}")


if __name__ == '__main__':
    sys.exit(main())
